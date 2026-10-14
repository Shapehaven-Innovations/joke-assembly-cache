import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { usageProblems, usageWarnings, windowLines } from "./check-usage.mjs";
import { buildCounts } from "./build-counts.mjs";

const SCRIPT = fileURLToPath(new URL("./check-usage.mjs", import.meta.url));
const WORKFLOW = fileURLToPath(new URL("../.github/workflows/publish-counts.yml", import.meta.url));
const exp = (usage) => ({ v: 1, generatedAt: "2026-10-11T12:00:00.000Z", counts: {}, ...(usage ? { usage } : {}) });
const usage = (over = {}) => ({ requestsUsed: 100, budget: 15000, writeUnitsUsed: 100, writeCap: 20000, ...over });

test("usage at or below 70% of both limits is fine", () => {
  assert.deepEqual(usageProblems(exp(usage())), []);
  assert.deepEqual(usageProblems(exp(usage({ requestsUsed: 10500, writeUnitsUsed: 14000 }))), []); // exactly 70%
});

test("requests above 70% of the budget fail with a clear message", () => {
  const p = usageProblems(exp(usage({ requestsUsed: 10501 })));
  assert.equal(p.length, 1);
  assert.match(p[0], /requests/i);
  assert.match(p[0], /10501/);
  assert.match(p[0], /15000/);
});

test("write units above 70% of the cap fail with a clear message", () => {
  const p = usageProblems(exp(usage({ writeUnitsUsed: 14001 })));
  assert.equal(p.length, 1);
  assert.match(p[0], /write/i);
});

test("both over reports both", () => {
  assert.equal(usageProblems(exp(usage({ requestsUsed: 15000, writeUnitsUsed: 20000 }))).length, 2);
});

test("a missing or malformed usage block is a failure, not a pass", () => {
  for (const bad of [exp(), exp({}), exp(usage({ budget: 0 })), exp(usage({ writeCap: -1 })), exp(usage({ requestsUsed: "5" })), exp(usage({ writeUnitsUsed: null })), null, 5]) {
    assert.ok(usageProblems(bad).length > 0, JSON.stringify(bad));
  }
});

test("a purge backlog is a warning, never a failure", () => {
  assert.deepEqual(usageWarnings(exp(usage({ purgeBacklog: false }))), []);
  assert.deepEqual(usageWarnings(exp(usage())), []);
  assert.equal(usageWarnings(exp(usage({ purgeBacklog: true }))).length, 1);
  assert.deepEqual(usageProblems(exp(usage({ purgeBacklog: true }))), []);
  const dir = mkdtempSync(join(tmpdir(), "cu-"));
  const file = join(dir, "export.json");
  writeFileSync(file, JSON.stringify(exp(usage({ purgeBacklog: true }))));
  const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /::warning::/);
});

test("buildCounts ignores usage and never publishes it", () => {
  const out = buildCounts(exp(usage()));
  assert.deepEqual(Object.keys(out), ["v", "generatedAt", "counts"]);
  assert.equal(JSON.stringify(out).includes("usage"), false);
  assert.equal(JSON.stringify(out).includes("budget"), false);
});

test("CLI exits non-zero with the message on stderr when over 70%, zero otherwise", () => {
  const dir = mkdtempSync(join(tmpdir(), "cu-"));
  const file = join(dir, "export.json");
  writeFileSync(file, JSON.stringify(exp(usage({ requestsUsed: 14000 }))));
  const bad = spawnSync(process.execPath, [SCRIPT, file], { encoding: "utf8" });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /70%/);
  writeFileSync(file, JSON.stringify(exp(usage())));
  assert.equal(spawnSync(process.execPath, [SCRIPT, file], { encoding: "utf8" }).status, 0);
  assert.notEqual(spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" }).status, 0);
  writeFileSync(file, "<html>");
  assert.notEqual(spawnSync(process.execPath, [SCRIPT, file], { encoding: "utf8" }).status, 0);
});

test("the workflow runs the usage check as the last step, after the counts were published", () => {
  const yml = readFileSync(WORKFLOW, "utf8");
  const check = yml.indexOf("node scripts/check-usage.mjs export.json");
  assert.ok(check > 0, "check step present");
  assert.ok(check > yml.indexOf("actions/deploy-pages"), "runs after deploy");
  assert.ok(check > yml.indexOf("Daily history snapshot"), "runs last");
  assert.equal(yml.includes("usage"), true);
  assert.equal(/counts\.json[^\n]*usage/.test(yml), false);
});

test("window stats are printed as plain numbers and never change the verdict", () => {
  const input = exp(usage({ windows: [{ start: 1792890000, rooms: 1, peak: 7, joins: 12 }, { start: "x" }, { start: 1, rooms: -1, peak: 0, joins: 0 }] }));
  assert.deepEqual(windowLines(input), ["Joke Hour 2026-10-25 01:00 UTC: peak 7 people, 12 joins, 1 room"]);
  assert.deepEqual(usageProblems(input), []);
  assert.deepEqual(windowLines(exp(usage())), []);
  assert.deepEqual(windowLines(exp(usage({ windows: "nope" }))), []);
});

test("the CLI prints the window lines to the log", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-"));
  const file = join(dir, "export.json");
  writeFileSync(file, JSON.stringify(exp(usage({ windows: [{ start: 1792890000, rooms: 2, peak: 9, joins: 30 }] }))));
  const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /check-usage: Joke Hour 2026-10-25 01:00 UTC: peak 9 people, 30 joins, 2 rooms/);
});
