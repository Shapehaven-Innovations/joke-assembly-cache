import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ID = /^[a-z]+-\d{3}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export function buildCounts(input, minTotal = 5) {
  if (!input || typeof input !== "object" || input.v !== 1 || typeof input.generatedAt !== "string" || typeof input.counts !== "object" || input.counts === null || Array.isArray(input.counts)) {
    throw new Error("invalid export");
  }
  if (!ISO_UTC.test(input.generatedAt) || Number.isNaN(Date.parse(input.generatedAt))) throw new Error("invalid generatedAt");
  const counts = {};
  for (const id of Object.keys(input.counts).sort()) {
    const pair = input.counts[id];
    if (!ID.test(id) || !Array.isArray(pair) || pair.length !== 2) continue;
    const [laughs, groans] = pair;
    if (!Number.isSafeInteger(laughs) || !Number.isSafeInteger(groans) || laughs < 0 || groans < 0 || laughs + groans < minTotal) continue;
    counts[id] = [laughs, groans];
  }
  return { v: 1, generatedAt: input.generatedAt, counts };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [inFile, outFile] = process.argv.slice(2);
  if (!inFile || !outFile) { console.error("usage: build-counts.mjs <export.json> <out/counts.json>"); process.exit(2); }
  const out = buildCounts(JSON.parse(readFileSync(inFile, "utf8")));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(out));
  console.log(`wrote ${outFile} (${Object.keys(out.counts).length} jokes)`);
}
