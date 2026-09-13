// Pre-builds data/embeddings.json so production doesn't pay for it on a cold
// start. The chat route rebuilds automatically when this snapshot is missing
// or out of date (see lib/knowledge.js), so running this by hand is an
// optimization, not a requirement.
import { readSources, buildKnowledgeIndex, writeSnapshot } from '../lib/knowledge.js';

const sources = await readSources();
if (sources.length === 0) {
  console.error('No knowledge/*.md files found.');
  process.exit(1);
}

const index = await buildKnowledgeIndex(sources, (done, total) =>
  process.stdout.write(`embedding chunk ${done}/${total}...\n`),
);
const output = await writeSnapshot(index);
console.log(`Wrote ${index.entries.length} chunks to ${output}`);
