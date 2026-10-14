import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTop, loadHistory, MAX_HISTORY_BYTES } from "./build-top.mjs";

const SCRIPT = fileURLToPath(new URL("./build-top.mjs", import.meta.url));
const AT = "2026-10-13T12:00:00.000Z";
const counts = (c, at = AT, extra = {}) => ({ v: 1, generatedAt: at, counts: c, ...extra });
const hist = (entries) => new Map(Object.entries(entries));

test("all time: top by laughs, ties by fewer groans, then id", () => {
  const out = buildTop(counts({ "dad-002": [10, 3], "dad-001": [10, 3], "puns-001": [10, 1], "food-001": [50, 0], "tech-001": [4, 1] }));
  assert.deepEqual(out.allTime, [["food-001", 50], ["puns-001", 10], ["dad-001", 10], ["dad-002", 10], ["tech-001", 4]]);
  assert.deepEqual(Object.keys(out), ["v", "generatedAt", "week", "allTime"]);
  assert.equal(out.generatedAt, AT);
});

test("a joke below 5 total reactions is never listed", () => {
  assert.deepEqual(buildTop(counts({ "dad-001": [3, 1] })).allTime, []);
});

test("week: delta against the snapshot dated D-7, threshold 3, ties by laughs then id", () => {
  const base = counts({ "dad-001": [10, 0], "dad-002": [20, 0], "puns-001": [5, 0] }, "2026-10-06T12:00:00.000Z");
  const out = buildTop(counts({ "dad-001": [15, 0], "dad-002": [22, 0], "puns-001": [10, 0], "food-001": [9, 0] }), hist({ "2026-10-06": base }));
  // dad-001 +5, puns-001 +5, food-001 absent from the baseline: 9 - 4 = +5, dad-002 +2 (below 3)
  assert.deepEqual(out.week, [["dad-001", 5], ["puns-001", 5], ["food-001", 5]]);   // all +5: ties by total laughs 15, 10, 9
});

test("week falls back to D-6, then D-8, else []", () => {
  const cur = counts({ "dad-001": [20, 0] });
  const b6 = counts({ "dad-001": [10, 0] }, "2026-10-07T12:00:00.000Z");
  const b8 = counts({ "dad-001": [15, 0] }, "2026-10-05T12:00:00.000Z");
  assert.deepEqual(buildTop(cur, hist({ "2026-10-07": b6, "2026-10-05": b8 })).week, [["dad-001", 10]]);
  assert.deepEqual(buildTop(cur, hist({ "2026-10-05": b8 })).week, [["dad-001", 5]]);
  assert.deepEqual(buildTop(cur, hist({ "2026-10-01": b8 })).week, []);
  assert.deepEqual(buildTop(cur).week, []);
});

test("negative deltas clamp to 0 and are not listed", () => {
  const base = counts({ "dad-001": [30, 0] }, "2026-10-06T00:00:00.000Z");
  assert.deepEqual(buildTop(counts({ "dad-001": [20, 0] }), hist({ "2026-10-06": base })).week, []);
});

test("at most 10 rows per list, ids all match the pattern, numbers are safe integers", () => {
  const c = {};
  for (let i = 1; i <= 15; i++) c[`dad-${String(i).padStart(3, "0")}`] = [100 + i, 0];
  const base = counts({}, "2026-10-06T00:00:00.000Z");
  const out = buildTop(counts(c), hist({ "2026-10-06": base }));
  assert.equal(out.allTime.length, 10);
  assert.equal(out.week.length, 10);
  for (const [id, n] of [...out.week, ...out.allTime]) { assert.match(id, /^[a-z]+-\d{3}$/); assert.ok(Number.isSafeInteger(n) && n >= 0); }
});

test("invalid counts input throws", () => {
  for (const bad of [null, {}, counts({ "dad-001": [1, 2] }, "nope"), counts({ BAD: [9, 9] }), counts({ "dad-001": [1.5, 9] }), counts({ "dad-001": [-1, 9] }), { v: 2, generatedAt: AT, counts: {} }]) {
    assert.throws(() => buildTop(bad), /invalid/);
  }
});

test("a malformed history entry is ignored with a warning, never fatal", () => {
  const cur = counts({ "dad-001": [20, 0] });
  for (const bad of [{ v: 2 }, counts({ BAD: [1, 1] }, "2026-10-06T00:00:00.000Z"), "text", null]) {
    assert.deepEqual(buildTop(cur, hist({ "2026-10-06": bad })).week, []);
  }
});

test("usage and purgeBacklog never reach top.json", () => {
  const out = buildTop(counts({ "dad-001": [9, 0] }, AT, { usage: { requestsUsed: 1, windows: [] }, purgeBacklog: true }));
  const text = JSON.stringify(out);
  assert.equal(text.includes("usage"), false);
  assert.equal(text.includes("purgeBacklog"), false);
  assert.equal(text.includes("windows"), false);
});

test("loadHistory reads only YYYY-MM-DD.json files under the size cap", () => {
  const dir = mkdtempSync(join(tmpdir(), "hist-"));
  writeFileSync(join(dir, "2026-10-06.json"), JSON.stringify(counts({ "dad-001": [1, 4] }, "2026-10-06T00:00:00.000Z")));
  writeFileSync(join(dir, "2026-10-07.json"), "{not json");
  writeFileSync(join(dir, "notes.json"), "{}");
  writeFileSync(join(dir, "2026-10-08.json"), " ".repeat(MAX_HISTORY_BYTES + 1));
  mkdirSync(join(dir, "2026-10-09.json"));
  const h = loadHistory(dir);
  assert.deepEqual([...h.keys()], ["2026-10-06"]);
  assert.deepEqual([...loadHistory(join(dir, "missing")).keys()], []);
});

test("CLI end to end", () => {
  const dir = mkdtempSync(join(tmpdir(), "top-"));
  mkdirSync(join(dir, "history"));
  writeFileSync(join(dir, "counts.json"), JSON.stringify(counts({ "dad-001": [20, 1] })));
  writeFileSync(join(dir, "history", "2026-10-06.json"), JSON.stringify(counts({ "dad-001": [10, 1] }, "2026-10-06T12:00:00.000Z")));
  const r = spawnSync(process.execPath, [SCRIPT, join(dir, "counts.json"), join(dir, "history"), join(dir, "public", "top.json")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /wrote .*top\.json \(week 1, allTime 1\)/);
  assert.equal(readFileSync(join(dir, "public", "top.json"), "utf8"),
    `{"v":1,"generatedAt":"${AT}","week":[["dad-001",10]],"allTime":[["dad-001",20]]}`);
  assert.notEqual(spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" }).status, 0, "usage error without arguments");
});
