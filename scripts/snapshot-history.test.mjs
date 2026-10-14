import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotPlan, KEEP } from "./snapshot-history.mjs";

const SCRIPT = fileURLToPath(new URL("./snapshot-history.mjs", import.meta.url));
const COUNTS = `{"v":1,"generatedAt":"2026-10-13T12:00:00.000Z","counts":{"dad-001":[9,1]}}`;
const days = (n, from = 1) => Array.from({ length: n }, (_, i) => `2026-10-${String(from + i).padStart(2, "0")}.json`);

test("writes once a UTC day and never overwrites", () => {
  assert.deepEqual(snapshotPlan([], "2026-10-13"), { write: true, remove: [] });
  assert.deepEqual(snapshotPlan(["2026-10-13.json"], "2026-10-13"), { write: false, remove: [] });
});

test("keeps the newest 8 snapshots and ignores other files", () => {
  const plan = snapshotPlan([...days(8), "README.md", "notes.json"], "2026-10-13");
  assert.equal(plan.write, true);
  assert.deepEqual(plan.remove, ["2026-10-01.json"]);
  assert.equal(KEEP, 8);
});

function run(dir) {
  const counts = join(dir, "counts.json");
  writeFileSync(counts, COUNTS);
  return spawnSync(process.execPath, [SCRIPT, counts, join(dir, "history")], { encoding: "utf8" });
}

test("CLI prints the date only when it wrote, and the copy is byte-identical", () => {
  const dir = mkdtempSync(join(tmpdir(), "snap-"));
  const first = run(dir);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, "2026-10-13\n");
  assert.equal(readFileSync(join(dir, "history", "2026-10-13.json"), "utf8"), COUNTS);
  const second = run(dir);
  assert.equal(second.status, 0);
  assert.equal(second.stdout, "", "nothing written, nothing printed");
});

test("CLI prunes beyond 8 and refuses an invalid counts file", () => {
  const dir = mkdtempSync(join(tmpdir(), "snap-"));
  mkdirSync(join(dir, "history"));
  for (const n of days(9)) writeFileSync(join(dir, "history", n), COUNTS);
  assert.equal(run(dir).status, 0);
  const left = readdirSync(join(dir, "history")).sort();
  assert.equal(left.length, 8);
  assert.equal(left.at(-1), "2026-10-13.json");
  writeFileSync(join(dir, "counts.json"), "{\"v\":2}");
  assert.notEqual(spawnSync(process.execPath, [SCRIPT, join(dir, "counts.json"), join(dir, "history")], { encoding: "utf8" }).status, 0);
});

import { readFileSync as readText } from "node:fs";
const WORKFLOW = fileURLToPath(new URL("../.github/workflows/publish-counts.yml", import.meta.url));

test("workflow: no keepalive, snapshot after deploy, check-usage still runs when the snapshot fails", () => {
  const yml = readText(WORKFLOW, "utf8");
  assert.equal(/keepalive/i.test(yml), false, "the keepalive step is replaced by the daily snapshot commit");
  const deploy = yml.indexOf("actions/deploy-pages");
  const snap = yml.indexOf("node scripts/snapshot-history.mjs public/counts.json history");
  const top = yml.indexOf("node scripts/build-top.mjs public/counts.json history public/top.json");
  const check = yml.indexOf("node scripts/check-usage.mjs export.json");
  assert.ok(top > 0 && top < yml.indexOf("actions/upload-pages-artifact"), "top.json is built before the upload");
  assert.ok(/build-top\.mjs[^\n]*\|\| echo "::warning::/.test(yml), "a failed top.json never blocks counts.json");
  assert.ok(snap > deploy, "the snapshot commit comes after the Pages deploy");
  assert.ok(check > snap, "check-usage is last");
  assert.ok(/!cancelled\(\) && steps\.export\.outcome == 'success'/.test(yml), "check-usage keeps !cancelled()");
  assert.ok(/id: export/.test(yml));
  assert.ok(/git add -A history/.test(yml), "only history/ is committed");
  assert.equal(/git add[^\n]*export\.json/.test(yml), false, "the raw export is never committed");
  assert.ok(/if: \$\{\{ !github\.event\.repository\.fork \}\}/.test(yml));
  assert.ok(/cancel-in-progress: false/.test(yml), "runs never push at once");
  assert.equal(/on:\s*\n\s*push/.test(yml), false, "a push never starts the workflow");
});

test("workflow: credentials are not persisted, the token reaches only the push step, the push is rebased and skipped when empty", () => {
  const yml = readText(WORKFLOW, "utf8");
  assert.ok(/actions\/checkout@v\d+\n\s+with:\n(\s+#[^\n]*\n)*\s+persist-credentials: false/.test(yml), "checkout does not leave the token in .git/config");
  const snapStep = yml.slice(yml.indexOf("- name: Daily history snapshot"), yml.indexOf("- name: Fail the run when Worker usage"));
  assert.ok(/GH_TOKEN: \$\{\{ github\.token \}\}/.test(snapStep), "the push step gets the token");
  assert.equal((yml.match(/github\.token/g) ?? []).length, 1, "and nothing else does");
  assert.ok(snapStep.includes("git diff --cached --quiet ||"), "nothing staged, nothing committed");
  assert.ok(snapStep.indexOf("git pull --rebase") > 0 && snapStep.indexOf("git pull --rebase") < snapStep.indexOf("git push"), "rebase before the push");
});

test("gitignore keeps the built files out and history in", () => {
  const ignore = readText(fileURLToPath(new URL("../.gitignore", import.meta.url)), "utf8");
  assert.ok(ignore.includes("public/top.json"));
  assert.equal(ignore.includes("history"), false);
});
