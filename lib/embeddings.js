import { pipeline } from '@xenova/transformers';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

let extractorPromise = null;

// Kept warm at module scope so repeated calls (e.g. per chat request)
// don't pay the model load cold-start cost again.
function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', MODEL_NAME);
  }
  return extractorPromise;
}

export async function embed(text) {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

export function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  // Vectors are already L2-normalized by the embed() call above, so the dot
  // product alone is the cosine similarity (no need to divide by norms).
  return dot;
}

export function topKMatches(queryVector, entries, k = 4) {
  return entries
    .map((entry) => ({ entry, score: cosineSimilarity(queryVector, entry.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
