import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wf = readFileSync(new URL("../.github/workflows/publish-counts.yml", import.meta.url), "utf8");

test("the schedule runs twice an hour, away from the busy :00 and :30 minutes", () => {
  const crons = [...wf.matchAll(/cron: "([^"]+)"/g)].map((m) => m[1]);
  assert.equal(crons.length, 1);
  const [minute, ...rest] = crons[0].split(" ");
  assert.deepEqual(rest, ["*", "*", "*", "*"]);
  const minutes = minute.split(",").map(Number);
  assert.equal(minutes.length, 2); // more runs would approach the Worker's daily export cap
  for (const m of minutes) assert.ok(Number.isInteger(m) && m > 0 && m < 60 && m !== 30, minute);
});
