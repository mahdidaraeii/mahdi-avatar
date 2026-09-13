import { embed } from '@/lib/embeddings';
import { readSources, hashSources, buildKnowledgeIndex, readSnapshot, writeSnapshot, search } from '@/lib/knowledge';

export const runtime = 'nodejs';

// Calibrated against this corpus on the hybrid score (cosine + term overlap,
// see lib/knowledge.js): across a 17-question on-topic set the weakest top
// score is 0.29, while genuinely off-topic questions top out at 0.20.
const SIMILARITY_THRESHOLD = 0.25;
const TOP_K = 4;
// Kept low to reinforce the 1-sentence (2 max) brevity constraint in the
// system prompt — don't rely on the prompt alone to keep replies short.
// Whatever this is set to, a dense enough answer can still hit it, so
// trimToSpeakable() below guarantees we never read a half-word aloud.
const MAX_TOKENS = 60;
// Chat moved off OpenRouter to Gemini directly (2026-09): OpenRouter's
// free-tier request quota is shared across all :free model calls on the
// account, and chat + Flux TTS were both drawing from that same pool.
// Splitting chat onto a separate provider roughly doubles effective daily
// headroom. TTS stays on OpenRouter (deepgram/flux-tts:free) — unaffected.
// flash-lite has thinking off by default, so MAX_TOKENS isn't silently
// eaten by reasoning tokens the way it would be on flash/pro.
// gemini-2.5-flash-lite is no longer available to new API keys (Google's API
// returns a 404 recommending this exact replacement) — same flash-lite tier.
const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const FALLBACK_REPLY = "That's one for the real Mahdi — I don't have that in my notes.";
const BASE_PROMPT = `You are Mahdi Esmaeili Daraei, speaking about yourself out loud in first person.

Extract and answer with only the specific fact or facts the question actually asked for — never the full sentence or paragraph it came from, and never surrounding color, asides, or tone from the source text, even when that text is sitting right there in the context. Hard cap: 1 sentence by default, and under 35 words. Use 2 sentences only if the question genuinely has multiple distinct parts that can't be answered in one. If the source lists many items, name the few most relevant rather than reciting the whole list. No preamble, don't restate the question, no "additionally" or "it's worth noting" style padding.

If the context distinguishes between "the real Mahdi" and "this digital version" of him (e.g. for language ability), preserve that distinction exactly as written — answer for yourself, the digital version, and don't merge the two into one blended fact or claim the real Mahdi's abilities as your own.

Your answer is read aloud by a text-to-speech engine, not displayed as text someone reads. Write plain spoken prose only — no markdown, no bullet points, no asterisks, no dashes used as punctuation, no headers, nothing that only makes sense written down. Say abbreviations, acronyms, and symbols the way a person would actually say them out loud (e.g. "M.Sc." becomes "master's," not spelled out letter by letter).`;
const NO_CONTEXT_INSTRUCTION = `No matching personal information was found for this message. If it's a greeting, casual remark, or small talk, respond naturally and briefly, in character. If it's a real question about me that you don't have information for, deflect in character, like "That's one for the real Mahdi, I don't have that in my notes" — never a flat, clinical line like "I do not have that in my background information." Never guess or invent specific facts about me.`;

let cache = null; // { hash, entries }
let inFlight = null;

// Nothing watches knowledge/*.md, so the fingerprint is re-checked per request
// (reading a few KB of markdown is far cheaper than the embedding call that
// follows). If it doesn't match the snapshot, the index is rebuilt in memory
// right here — editing the knowledge base can't silently keep serving stale
// answers, with or without `npm run build:embeddings`.
async function loadEntries() {
  const sources = await readSources();
  const hash = hashSources(sources);
  if (cache?.hash === hash) return cache.entries;
  if (inFlight?.hash === hash) return inFlight.promise;

  const promise = (async () => {
    const snapshot = await readSnapshot();
    let index = snapshot?.hash === hash ? snapshot : null;
    if (!index) {
      console.warn('[knowledge] embeddings snapshot missing or stale — rebuilding in memory');
      index = await buildKnowledgeIndex(sources);
      // Best effort: persists the rebuild in dev so it happens once, and is
      // expected to fail on a read-only production filesystem.
      await writeSnapshot(index).catch(() => {});
    }
    cache = { hash, entries: index.entries };
    return index.entries;
  })();

  inFlight = { hash, promise };
  try {
    return await promise;
  } finally {
    inFlight = null;
  }
}

// A reply cut off at the token cap ends mid-word, and this text goes
// straight to a speech engine — "...structured E.R.D.s in Chen notat" is
// worse than a slightly shorter answer. Fall back to the last complete
// sentence, or failing that the last whole word.
function trimToSpeakable(text) {
  const lastSentenceEnd = Math.max(text.lastIndexOf('.'), text.lastIndexOf('!'), text.lastIndexOf('?'));
  if (lastSentenceEnd > 0) return text.slice(0, lastSentenceEnd + 1);
  const lastSpace = text.lastIndexOf(' ');
  return lastSpace > 0 ? `${text.slice(0, lastSpace).replace(/[,;:]$/, '')}.` : text;
}

export async function POST(request) {
  let message;
  try {
    ({ message } = await request.json());
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!message || typeof message !== 'string') {
    return Response.json({ error: 'message is required' }, { status: 400 });
  }

  // Sequential on purpose: both steps share one transformers.js pipeline
  // instance, so overlapping them buys nothing and risks interleaved calls.
  const entries = await loadEntries();
  const matches = search(await embed(message), message, entries, TOP_K);
  const hasContext = (matches[0]?.score ?? 0) >= SIMILARITY_THRESHOLD;

  const systemPrompt = hasContext
    ? `${BASE_PROMPT}\n\nAnswer using only the context below — never invent details that aren't there.\n\nContext:\n${matches.map((m) => m.entry.text).join('\n\n---\n\n')}`
    : `${BASE_PROMPT}\n\n${NO_CONTEXT_INSTRUCTION}`;

  const response = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: {
      'x-goog-api-key': process.env.GEMINI_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: message }] }],
      generationConfig: { maxOutputTokens: MAX_TOKENS },
    }),
  });

  if (!response.ok) {
    console.error('Gemini error', response.status, await response.text());
    return Response.json({ error: 'chat completion failed' }, { status: response.status === 429 ? 429 : 502 });
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  let reply = candidate?.content?.parts?.[0]?.text?.trim() || '';
  if (candidate?.finishReason === 'MAX_TOKENS') reply = trimToSpeakable(reply);

  return Response.json({ reply: reply || FALLBACK_REPLY });
}
