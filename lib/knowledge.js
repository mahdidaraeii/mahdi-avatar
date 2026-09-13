import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { embed, cosineSimilarity } from './embeddings.js';

const KNOWLEDGE_DIR = path.join(process.cwd(), 'knowledge');
const SNAPSHOT_FILE = path.join(process.cwd(), 'data', 'embeddings.json');

// Rough chars-per-token heuristic for English prose, good enough for chunking.
const CHARS_PER_TOKEN = 4;
// A paragraph shorter than this makes a thin, noisy embedding on its own, so
// it gets absorbed into its neighbour — up to the MAX_CHARS ceiling.
const MIN_CHARS = 30 * CHARS_PER_TOKEN;
const MAX_CHARS = 250 * CHARS_PER_TOKEN;

// Bump when chunking changes shape, so existing snapshots are treated as
// stale and rebuilt even though knowledge/*.md itself hasn't been edited.
const CHUNKER_VERSION = 3;

/** Reads every knowledge/*.md, sorted by filename so the hash is stable. */
export async function readSources() {
  let files;
  try {
    files = (await readdir(KNOWLEDGE_DIR)).filter((f) => f.endsWith('.md')).sort();
  } catch {
    return [];
  }
  return Promise.all(
    files.map(async (file) => ({
      file,
      raw: await readFile(path.join(KNOWLEDGE_DIR, file), 'utf-8'),
    })),
  );
}

/** Fingerprint of the knowledge content + chunking rules that produced a snapshot. */
export function hashSources(sources) {
  const hash = createHash('sha256').update(`v${CHUNKER_VERSION}`);
  for (const { file, raw } of sources) hash.update(`\0${file}\0${raw}`);
  return hash.digest('hex');
}

// Drop authoring scaffolding so it never gets embedded: everything below the
// "---" divider is a TODO list, not facts, and the "[FILL IN: ...]"
// placeholders aren't facts either — matching them against a generic question
// produces confident-looking false positives.
function contentParagraphs(raw) {
  const all = raw
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const dividerIndex = all.indexOf('---');
  const body = dividerIndex === -1 ? all : all.slice(0, dividerIndex);
  return body.filter((p) => !/^\[FILL IN/i.test(p));
}

// Group into { heading, body } sections. Chunks never blend across a heading
// boundary — mixing unrelated ## sections into one embedding dilutes it enough
// that on-topic questions about a single section score as low as off-topic ones.
// A heading whose only body was a placeholder we just dropped ends up with an
// empty body, and the `body.length` checks discard it.
function toSections(paragraphs) {
  const sections = [];
  let current = { heading: '', body: [] };
  for (const paragraph of paragraphs) {
    if (paragraph.startsWith('#')) {
      if (current.body.length) sections.push(current);
      current = { heading: paragraph, body: [] };
    } else {
      current.body.push(paragraph);
    }
  }
  if (current.body.length) sections.push(current);
  return sections;
}

// One chunk per paragraph. A paragraph is already the unit of meaning here
// (one project, one topic each), and packing several together measurably hurt
// retrieval: mean-pooled MiniLM blends them, so a chunk holding both the
// avatar project and the bachelor's thesis scored below the Education chunk
// for "tell me about your bachelor thesis" and never reached the top 4.
// Paragraph boundaries also remove the need for overlap — they sit exactly
// where one idea stops and the next starts.
function chunkSection({ heading, body }) {
  const chunks = [];

  for (const paragraph of body) {
    const previous = chunks[chunks.length - 1];
    const mergeable =
      previous &&
      (previous.length < MIN_CHARS || paragraph.length < MIN_CHARS) &&
      previous.length + paragraph.length <= MAX_CHARS;
    if (mergeable) {
      chunks[chunks.length - 1] = `${previous}\n\n${paragraph}`;
    } else {
      chunks.push(paragraph);
    }
  }

  // Every chunk carries its heading, so a chunk from the middle of a section
  // still embeds with a clue what it's about.
  return heading ? chunks.map((text) => `${heading}\n\n${text}`) : chunks;
}

/** Splits the knowledge base into retrieval chunks (no embedding). */
export function chunkSources(sources) {
  const chunks = [];
  for (const { file, raw } of sources) {
    for (const text of toSections(contentParagraphs(raw)).flatMap(chunkSection)) {
      chunks.push({ id: String(chunks.length), text, sourceFile: file });
    }
  }
  return chunks;
}

/** Chunks + embeds the knowledge base. Returns the snapshot shape on disk. */
export async function buildKnowledgeIndex(sources, onProgress) {
  const chunks = chunkSources(sources);
  const entries = [];
  for (const chunk of chunks) {
    onProgress?.(entries.length + 1, chunks.length);
    entries.push({ ...chunk, vector: await embed(chunk.text) });
  }
  return { hash: hashSources(sources), entries };
}

export async function readSnapshot() {
  try {
    const snapshot = JSON.parse(await readFile(SNAPSHOT_FILE, 'utf-8'));
    return Array.isArray(snapshot.entries) ? snapshot : null;
  } catch {
    return null;
  }
}

export async function writeSnapshot(index) {
  await mkdir(path.dirname(SNAPSHOT_FILE), { recursive: true });
  await writeFile(SNAPSHOT_FILE, JSON.stringify(index));
  return path.relative(process.cwd(), SNAPSHOT_FILE);
}

// --- Retrieval -------------------------------------------------------------

// Dense embeddings alone are weakest exactly where this knowledge base is
// richest: rare proper nouns. all-MiniLM-L6-v2 is trained for symmetric
// sentence similarity, so a short query against a long jargon-dense passage
// gets washed out by mean pooling — "tell me about your bachelor thesis"
// scored 0.07 against the chunk that literally contains "Bachelor's thesis",
// ranking it 12th of 16, while the Education chunk (which never mentions a
// thesis) won at 0.37. Blending in an IDF-weighted term overlap fixes that
// class of question without a second model or a heavier index.
const LEXICAL_WEIGHT = 0.35;

const STOPWORDS = new Set(
  ('a about all am an and any are as at be been but by can did do does for from get got had has have how i if in is it its just like me my of on or so tell that the their them then there these they this to told too was what when where which who why will with would you your yours').split(' '),
);

function terms(text) {
  const matched = text.toLowerCase().match(/[a-z0-9][a-z0-9+#.-]*/g) || [];
  return matched.map((t) => t.replace(/[.-]+$/, '')).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// Fraction of the query's "information" (summed inverse document frequency)
// that the chunk actually contains, so a match on "teknofest" counts for far
// more than a match on "work".
function lexicalScores(query, entries) {
  const queryTerms = [...new Set(terms(query))];
  const chunkTerms = entries.map((entry) => new Set(terms(entry.text)));

  const idf = new Map();
  for (const term of queryTerms) {
    const docFreq = chunkTerms.reduce((n, set) => n + (set.has(term) ? 1 : 0), 0);
    idf.set(term, Math.log(1 + entries.length / (1 + docFreq)));
  }
  const total = queryTerms.reduce((sum, term) => sum + idf.get(term), 0);
  if (total === 0) return entries.map(() => 0);

  return chunkTerms.map((set) => {
    const matched = queryTerms.reduce((sum, term) => sum + (set.has(term) ? idf.get(term) : 0), 0);
    return matched / total;
  });
}

/** Top-k chunks for a query, scored by cosine similarity blended with term overlap. */
export function search(queryVector, query, entries, k) {
  const lexical = lexicalScores(query, entries);
  return entries
    .map((entry, i) => ({
      entry,
      score: cosineSimilarity(queryVector, entry.vector) + LEXICAL_WEIGHT * lexical[i],
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
