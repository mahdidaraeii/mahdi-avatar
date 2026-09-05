import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { embed, topKMatches } from '@/lib/embeddings';

export const runtime = 'nodejs';

// Calibrated against this corpus/model (all-MiniLM-L6-v2, mean-pooled):
// off-topic queries top out around 0.20-0.23, on-topic ones start at 0.31+.
const SIMILARITY_THRESHOLD = 0.25;
const TOP_K = 4;
const MAX_TOKENS = 200;
// Fallback chain: 2-3 free OpenRouter models, tried in order if one fails.
// Free-tier slugs churn often — check https://openrouter.ai/models?max_price=0
// if these start 404ing.
const MODELS = [
  'google/gemma-4-31b-it:free',
  'z-ai/glm-5.2:free',
  'minimax/minimax-m3:free',
];
const FALLBACK_REPLY = "I don't have information about that.";

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
  if (bestScore < SIMILARITY_THRESHOLD) {
    return Response.json({ reply: FALLBACK_REPLY });
  }

  const context = matches.map((m) => m.entry.text).join('\n\n---\n\n');
  const systemPrompt = `You are Mahdi Esmaeili Daraei, answering questions about yourself in first person. Answer using only the context below — don't invent details that aren't there. Be concise: 2-4 sentences.\n\nContext:\n${context}`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      models: MODELS,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
    }),
  });

  if (!response.ok) {
    console.error('OpenRouter error', response.status, await response.text());
    return Response.json({ error: 'chat completion failed' }, { status: 502 });
  }

  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content?.trim() || FALLBACK_REPLY;

  return Response.json({ reply });
}
