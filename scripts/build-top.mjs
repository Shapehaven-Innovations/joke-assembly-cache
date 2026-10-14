// Builds public/top.json ("Top jokes") from the published counts.json and the daily snapshots in history/.
// Reads only v, generatedAt and counts, so nothing from the export's usage block can reach top.json.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ID = /^[a-z]+-\d{3}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
export const HISTORY_NAME = /^\d{4}-\d{2}-\d{2}\.json$/;
export const MAX_ROWS = 10;
/** Owner decision D2 (2026-10-13). Raise without an app update if lists look noisy. */
export const MIN_TOTAL = 5;
export const MIN_WEEK_GAIN = 3;
/** A joke absent from the baseline had fewer than MIN_TOTAL reactions then, so at most this many laughs (lower bound). */
export const ABSENT_BASELINE = MIN_TOTAL - 1;
export const MAX_HISTORY_BYTES = 256 * 1024;
export const MAX_HISTORY_IDS = 2000;
const DAY_MS = 86_400_000;
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Strictly validates a counts.json-shaped object; returns { generatedAt, counts: Map(id -> [laughs, groans]) } or throws. */
export function readCounts(input, label = "counts", maxIds = Infinity) {
  const bad = () => new Error(`invalid ${label}`);
  if (!input || typeof input !== "object" || Array.isArray(input) || input.v !== 1 || typeof input.generatedAt !== "string"
    || !ISO_UTC.test(input.generatedAt) || Number.isNaN(Date.parse(input.generatedAt))
    || !input.counts || typeof input.counts !== "object" || Array.isArray(input.counts)) throw bad();
  const ids = Object.keys(input.counts);
  if (ids.length > maxIds) throw bad();
  const counts = new Map();
  for (const id of ids) {
    const pair = input.counts[id];
    if (!ID.test(id) || !Array.isArray(pair) || pair.length !== 2) throw bad();
    const [l, g] = pair;
    if (!Number.isSafeInteger(l) || !Number.isSafeInteger(g) || l < 0 || g < 0) throw bad();
    counts.set(id, [l, g]);
  }
  return { generatedAt: input.generatedAt, counts };
}

const dayString = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The snapshot dated D-7, else D-6, else D-8 (D = UTC date of generatedAt); null when none is valid. */
export function pickBaseline(generatedAt, validHistory) {
  const d0 = Date.parse(`${generatedAt.slice(0, 10)}T00:00:00Z`);
  for (const back of [7, 6, 8]) {
    const h = validHistory.get(dayString(d0 - back * DAY_MS));
    if (h) return h;
  }
  return null;
}

/** Pure. `historyByDate`: Map("YYYY-MM-DD" -> parsed but unvalidated snapshot). */
export function buildTop(countsInput, historyByDate = new Map()) {
  const cur = readCounts(countsInput);
  const valid = new Map();
  for (const [day, raw] of historyByDate) {
    try { valid.set(day, readCounts(raw, `history ${day}`, MAX_HISTORY_IDS)); }
    catch (e) { console.warn(`::warning::build-top: ignored history ${day}: ${e.message}`); }
  }
  const eligible = [...cur.counts].filter(([, [l, g]]) => l + g >= MIN_TOTAL);
  const allTime = eligible
    .slice()
    .sort(([a, [la, ga]], [b, [lb, gb]]) => lb - la || ga - gb || byId(a, b))
    .slice(0, MAX_ROWS)
    .map(([id, [l]]) => [id, l]);
  const base = pickBaseline(cur.generatedAt, valid);
  const week = !base ? [] : eligible
    .map(([id, [l]]) => {
      const b = base.counts.get(id);
      return [id, Math.max(0, l - (b ? b[0] : ABSENT_BASELINE)), l];
    })
    .filter(([, delta]) => delta >= MIN_WEEK_GAIN)
    .sort(([a, da, la], [b, db, lb]) => db - da || lb - la || byId(a, b))
    .slice(0, MAX_ROWS)
    .map(([id, delta]) => [id, delta]);
  for (const [id, n] of [...week, ...allTime]) {
    if (!ID.test(id) || !Number.isSafeInteger(n) || n < 0) throw new Error("invalid output");
  }
  return { v: 1, generatedAt: cur.generatedAt, week, allTime };
}

/** Reads history/YYYY-MM-DD.json files (size-checked before reading). Anything else, or anything unreadable, is skipped with a warning. */
export function loadHistory(dir) {
  const out = new Map();
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names.sort()) {
    if (!HISTORY_NAME.test(name)) continue;
    const path = join(dir, name);
    try {
      const st = statSync(path);
      if (!st.isFile() || st.size > MAX_HISTORY_BYTES) { console.warn(`::warning::build-top: ignored ${name} (not a file or over ${MAX_HISTORY_BYTES} bytes)`); continue; }
      out.set(name.slice(0, 10), JSON.parse(readFileSync(path, "utf8")));
    } catch (e) {
      console.warn(`::warning::build-top: ignored ${name}: ${e.message}`);
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [countsFile, historyDir, outFile] = process.argv.slice(2);
  if (!countsFile || !historyDir || !outFile) { console.error("usage: build-top.mjs <counts.json> <history-dir> <out/top.json>"); process.exit(2); }
  const out = buildTop(JSON.parse(readFileSync(countsFile, "utf8")), loadHistory(historyDir));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(out));
  console.log(`wrote ${outFile} (week ${out.week.length}, allTime ${out.allTime.length})`);
}
