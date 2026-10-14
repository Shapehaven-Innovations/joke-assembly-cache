// Usage visibility without notifications (the Workers Free plan has none): the Worker's export carries a `usage` block, and this
// check fails the publisher run when the day's guard usage passes 70% of its limits, so GitHub emails the owner about the failed run.
// The usage block is never copied into counts.json (build-counts.mjs only reads v, generatedAt and counts).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const THRESHOLD = 0.7;

const num = (x) => typeof x === "number" && Number.isFinite(x);

/** Returns a list of human-readable problems; empty means fine. A missing or malformed usage block is a problem. */
export function usageProblems(input, threshold = THRESHOLD) {
  const u = input && typeof input === "object" ? input.usage : undefined;
  if (!u || typeof u !== "object") return ["the export has no usage block (is the Worker up to date?)"];
  if (!num(u.requestsUsed) || !num(u.writeUnitsUsed) || !num(u.budget) || !num(u.writeCap) || u.budget <= 0 || u.writeCap <= 0 || u.requestsUsed < 0 || u.writeUnitsUsed < 0) {
    return ["the export's usage block is malformed"];
  }
  const pct = Math.round(threshold * 100);
  const out = [];
  if (u.requestsUsed > u.budget * threshold) {
    out.push(`Worker requests used ${u.requestsUsed} of the daily guard budget ${u.budget}: over ${pct}%. Check the Lounge and the app before the guard starts refusing requests.`);
  }
  if (u.writeUnitsUsed > u.writeCap * threshold) {
    out.push(`Worker D1 write units used ${u.writeUnitsUsed} of the daily cap ${u.writeCap}: over ${pct}%. Writes stop at the cap.`);
  }
  return out;
}

/** Warnings never fail the run: the purge still has work waiting after this export's pass (not keeping up, or out of write budget). */
export function usageWarnings(input) {
  const u = input && typeof input === "object" ? input.usage : undefined;
  return u && typeof u === "object" && u.purgeBacklog === true
    ? ["the automatic cleanup of old anonymous ids still has work waiting after this run. If this repeats on every run, it is not keeping up with the daily write budget (see FREE_TIER_LIMITS.md, Purge throughput)."]
    : [];
}

/** Per-Joke-Hour numbers from the Worker (peak people at once, joins, rooms; no ids). Printed to the Action log only. */
export function windowLines(input) {
  const w = input && typeof input === "object" && input.usage && typeof input.usage === "object" ? input.usage.windows : undefined;
  if (!Array.isArray(w)) return [];
  const ok = (n) => Number.isSafeInteger(n) && n >= 0;
  return w
    .filter((x) => x && typeof x === "object" && ok(x.start) && ok(x.rooms) && ok(x.peak) && ok(x.joins))
    .slice(-24)
    .map((x) => `Joke Hour ${new Date(x.start * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC: peak ${x.peak} people, ${x.joins} joins, ${x.rooms} room${x.rooms === 1 ? "" : "s"}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error("usage: check-usage.mjs <export.json>"); process.exit(2); }
  let input;
  try { input = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.error(`check-usage: cannot read ${file}: ${e.message}`); process.exit(1); }
  for (const line of windowLines(input)) console.log(`check-usage: ${line}`);
  for (const w of usageWarnings(input)) console.log(`::warning::check-usage: ${w}`);
  const problems = usageProblems(input);
  if (problems.length) {
    for (const p of problems) console.error(`::error::check-usage: ${p} (limit: 70%)`);
    process.exit(1);
  }
  console.log("check-usage: usage is under 70% of the daily limits");
}
