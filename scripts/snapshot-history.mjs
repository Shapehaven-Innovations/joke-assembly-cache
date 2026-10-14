// Keeps one copy of the published counts.json per UTC day in history/ (the input for top.json's weekly list), newest 8 only.
// The copy is byte-identical to public/counts.json, which already holds only jokes with 5+ reactions and no usage block.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HISTORY_NAME, readCounts } from "./build-top.mjs";

export const KEEP = 8;

/** Pure: whether today's file must be written and which snapshot files to delete (oldest first, by name). */
export function snapshotPlan(existingNames, day) {
  const file = `${day}.json`;
  const snaps = existingNames.filter((n) => HISTORY_NAME.test(n));
  const write = !snaps.includes(file);
  const all = [...new Set([...snaps, file])].sort();
  return { write, remove: all.slice(0, Math.max(0, all.length - KEEP)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [countsFile, dir] = process.argv.slice(2);
  if (!countsFile || !dir) { console.error("usage: snapshot-history.mjs <counts.json> <history-dir>"); process.exit(2); }
  const { generatedAt } = readCounts(JSON.parse(readFileSync(countsFile, "utf8")));   // never snapshot an invalid file
  const day = generatedAt.slice(0, 10);
  mkdirSync(dir, { recursive: true });
  const { write, remove } = snapshotPlan(readdirSync(dir), day);
  if (write) copyFileSync(countsFile, join(dir, `${day}.json`));
  for (const name of remove) rmSync(join(dir, name), { force: true });
  if (write) process.stdout.write(`${day}\n`);
}
