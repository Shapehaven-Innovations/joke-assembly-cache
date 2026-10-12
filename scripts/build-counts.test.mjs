import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCounts } from "./build-counts.mjs";

const SCRIPT = fileURLToPath(new URL("./build-counts.mjs", import.meta.url));
const GOOD_AT = "2026-10-11T12:00:00Z";

const input = { v: 1, generatedAt: "2026-10-11T12:00:00.000Z", counts: { "dad-002": [3, 2], "dad-001": [10, 1], "puns-001": [2, 2], "BAD": [9, 9], "food-001": [-1, 9], "tech-001": [1.5, 5] } };

test("keeps valid entries with at least 5 reactions, sorted, drops the rest", () => {
  const out = buildCounts(input);
  assert.deepEqual(out, { v: 1, generatedAt: "2026-10-11T12:00:00.000Z", counts: { "dad-001": [10, 1], "dad-002": [3, 2] } });
  assert.deepEqual(Object.keys(out.counts), ["dad-001", "dad-002"]);
});

test("rejects invalid exports", () => {
  for (const bad of [null, 5, {}, { v: 2, generatedAt: GOOD_AT, counts: {} }, { v: 1, generatedAt: "nope", counts: {} }, { v: 1, generatedAt: GOOD_AT }, { v: 1, generatedAt: GOOD_AT, counts: null }]) {
    assert.throws(() => buildCounts(bad), /invalid/);
  }
});

test("an empty counts object is valid", () => {
  assert.deepEqual(buildCounts({ v: 1, generatedAt: GOOD_AT, counts: {} }).counts, {});
});

test("rejects counts given as an array", () => {
  assert.throws(() => buildCounts({ v: 1, generatedAt: GOOD_AT, counts: [] }), /invalid/);
  assert.throws(() => buildCounts({ v: 1, generatedAt: GOOD_AT, counts: [[5, 5]] }), /invalid/);
});

test("drops a __proto__ key without polluting the output", () => {
  const parsed = JSON.parse(`{"v":1,"generatedAt":"${GOOD_AT}","counts":{"__proto__":[9,9],"dad-001":[5,5]}}`);
  const out = buildCounts(parsed);
  assert.deepEqual(Object.keys(out.counts), ["dad-001"]);
  assert.equal(Object.getPrototypeOf(out.counts), Object.prototype);
});

test("drops huge and unsafe numbers", () => {
  const out = buildCounts({ v: 1, generatedAt: GOOD_AT, counts: {
    "big-001": [1e21, 1], "big-002": [1.7e308, 5], "big-003": [Number.MAX_SAFE_INTEGER + 1, 0], "ok-001": [5, 0],
  } });
  assert.deepEqual(out.counts, { "ok-001": [5, 0] });
});

test("drops pairs of the wrong length or type", () => {
  const out = buildCounts({ v: 1, generatedAt: GOOD_AT, counts: {
    "a-001": [5], "a-002": [5, 5, 5], "a-003": "55", "a-004": { 0: 5, 1: 5 }, "a-005": ["5", 5], "a-006": [null, 9], "a-007": null, "a-008": [true, 9], "ok-001": [3, 3],
  } });
  assert.deepEqual(out.counts, { "ok-001": [3, 3] });
});

test("generatedAt must be strict ISO-8601 UTC", () => {
  for (const ok of ["2026-10-11T12:00:00Z", "2026-10-11T12:00:00.000Z", "2026-10-11T12:00:00.1Z"]) {
    assert.equal(buildCounts({ v: 1, generatedAt: ok, counts: {} }).generatedAt, ok);
  }
  for (const bad of ["2026-10-11", "2026-10-11T12:00:00", "2026-10-11T12:00:00+02:00", "Oct 11 2026", "2026-10-11 12:00:00Z", "2026-13-45T12:00:00Z", "", " 2026-10-11T12:00:00Z", "2026-10-11T12:00:00Z\n"]) {
    assert.throws(() => buildCounts({ v: 1, generatedAt: bad, counts: {} }), /invalid/, bad);
  }
});

test("CLI exits non-zero and writes nothing for an invalid export", () => {
  const dir = mkdtempSync(join(tmpdir(), "bc-"));
  const inFile = join(dir, "export.json");
  const outFile = join(dir, "public", "counts.json");
  writeFileSync(inFile, JSON.stringify({ v: 2, generatedAt: GOOD_AT, counts: {} }));
  const r = spawnSync(process.execPath, [SCRIPT, inFile, outFile], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.equal(existsSync(outFile), false);
});

test("CLI exits non-zero for unparseable JSON and for missing arguments", () => {
  const dir = mkdtempSync(join(tmpdir(), "bc-"));
  const inFile = join(dir, "export.json");
  const outFile = join(dir, "counts.json");
  writeFileSync(inFile, "<html>not json</html>");
  assert.notEqual(spawnSync(process.execPath, [SCRIPT, inFile, outFile], { encoding: "utf8" }).status, 0);
  assert.equal(existsSync(outFile), false);
  assert.notEqual(spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" }).status, 0);
});

test("CLI writes the buildCounts output for a valid export", () => {
  const dir = mkdtempSync(join(tmpdir(), "bc-"));
  const inFile = join(dir, "export.json");
  const outFile = join(dir, "public", "counts.json");
  writeFileSync(inFile, JSON.stringify(input));
  const r = spawnSync(process.execPath, [SCRIPT, inFile, outFile], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(readFileSync(outFile, "utf8")), buildCounts(input));
});
