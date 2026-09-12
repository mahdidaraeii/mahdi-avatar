import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { embed, topKMatches } from '@/lib/embeddings';

export const runtime = 'nodejs';

// Calibrated against this corpus/model (all-MiniLM-L6-v2, mean-pooled):
// off-topic queries top out around 0.20-0.23, on-topic ones start at 0.31+.
const SIMILARITY_THRESHOLD = 0.25;
const TOP_K = 4;
// Kept low to reinforce the 1-sentence (2 max) brevity constraint in the
// system prompt — don't rely on the prompt alone to keep replies short.
const MAX_TOKENS = 45;
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

Extract and answer with only the specific fact or facts the question actually asked for — never the full sentence or paragraph it came from, and never surrounding color, asides, or tone from the source text, even when that text is sitting right there in the context. Hard cap: 1 sentence by default. Use 2 sentences only if the question genuinely has multiple distinct parts that can't be answered in one. No preamble, don't restate the question, no "additionally" or "it's worth noting" style padding.

If the context distinguishes between "the real Mahdi" and "this digital version" of him (e.g. for language ability), preserve that distinction exactly as written — answer for yourself, the digital version, and don't merge the two into one blended fact or claim the real Mahdi's abilities as your own.

Your answer is read aloud by a text-to-speech engine, not displayed as text someone reads. Write plain spoken prose only — no markdown, no bullet points, no asterisks, no dashes used as punctuation, no headers, nothing that only makes sense written down. Say abbreviations, acronyms, and symbols the way a person would actually say them out loud (e.g. "M.Sc." becomes "master's," not spelled out letter by letter).`;
const NO_CONTEXT_INSTRUCTION = `No matching personal information was found for this message. If it's a greeting, casual remark, or small talk, respond naturally and briefly, in character. If it's a real question about me that you don't have information for, deflect in character, like "That's one for the real Mahdi, I don't have that in my notes" — never a flat, clinical line like "I do not have that in my background information." Never guess or invent specific facts about me.`;

let embeddingsPromise = null;
function loadEmbeddings() {
  if (!embeddingsPromise) {
    const filePath = path.join(process.cwd(), 'data', 'embeddings.json');
    embeddingsPromise = readFile(filePath, 'utf-8').then((raw) => JSON.parse(raw));
  }
  return embeddingsPromise;
}

export async function POST(request) {
  const { message } = await request.json();

  if (!message || typeof message !== 'string') {
    return Response.json({ error: 'message is required' }, { status: 400 });
  }

  const entries = await loadEmbeddings();
  const queryVector = await embed(message);
  const matches = topKMatches(queryVector, entries, TOP_K);

  const bestScore = matches[0]?.score ?? 0;
  const hasContext = bestScore >= SIMILARITY_THRESHOLD;

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
    const status = response.status === 429 ? 429 : 502;
    return Response.json({ error: 'chat completion failed' }, { status });
  }

  const data = await response.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || FALLBACK_REPLY;

  return Response.json({ reply });
}
