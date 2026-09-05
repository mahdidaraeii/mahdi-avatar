import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { embed } from '../lib/embeddings.js';

const KNOWLEDGE_DIR = path.join(process.cwd(), 'knowledge');
const OUTPUT_FILE = path.join(process.cwd(), 'data', 'embeddings.json');

const TARGET_TOKENS = 200; // aim for ~150-250 tokens/chunk
const OVERLAP_TOKENS = 20;
// Rough chars-per-token heuristic for English prose, good enough for chunking.
const CHARS_PER_TOKEN = 4;
const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;

function isPlaceholder(paragraph) {
  return /^\[FILL IN/i.test(paragraph);
}

// Drop authoring scaffolding so it never gets embedded: the "[FILL IN: ...]"
// placeholders aren't facts about the person, and matching them against a
// generic question (e.g. "what's your favorite language?" vs. the empty
// "Skills & tools" section) produces confident-looking false positives.
function preprocessParagraphs(rawParagraphs) {
  const dividerIndex = rawParagraphs.findIndex((p) => p === '---');
  const contentParagraphs = dividerIndex === -1 ? rawParagraphs : rawParagraphs.slice(0, dividerIndex);
  const withoutPlaceholders = contentParagraphs.filter((p) => !isPlaceholder(p));

  // A heading whose only body was a placeholder we just removed is now
  // orphaned (heading directly followed by another heading, or nothing) —
  // drop it too rather than embed a section title with no content.
  const result = [];
  for (let i = 0; i < withoutPlaceholders.length; i++) {
    const paragraph = withoutPlaceholders[i];
    const next = withoutPlaceholders[i + 1];
    if (paragraph.startsWith('#') && (!next || next.startsWith('#'))) continue;
    result.push(paragraph);
  }
  return result;
}

function chunkParagraphs(paragraphs) {
  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    // Never blend across a heading boundary — mixing unrelated ## sections
    // into one embedding dilutes it enough that on-topic questions about a
    // single section can score as low as off-topic ones.
    if (paragraph.startsWith('#') && current) {
      chunks.push(current);
      current = paragraph;
      continue;
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > TARGET_CHARS && current) {
      chunks.push(current);
      // carry the tail of the previous chunk forward for overlap
      const overlap = current.slice(-OVERLAP_CHARS);
      current = `${overlap}\n\n${paragraph}`;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

async function main() {
  const files = (await readdir(KNOWLEDGE_DIR)).filter((f) => f.endsWith('.md'));
  const entries = [];
  let id = 0;

  for (const file of files) {
    const raw = await readFile(path.join(KNOWLEDGE_DIR, file), 'utf-8');
    const rawParagraphs = raw
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    const paragraphs = preprocessParagraphs(rawParagraphs);

    const chunks = chunkParagraphs(paragraphs);

    for (const text of chunks) {
      process.stdout.write(`embedding ${file} chunk ${id}...\n`);
      const vector = await embed(text);
      entries.push({ id: String(id), text, sourceFile: file, vector });
      id += 1;
    }
  }

  await mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(entries));
  console.log(`Wrote ${entries.length} chunks to ${path.relative(process.cwd(), OUTPUT_FILE)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
