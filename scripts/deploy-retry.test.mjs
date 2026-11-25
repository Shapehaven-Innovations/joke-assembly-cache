import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wf = readFileSync(new URL("../.github/workflows/publish-counts.yml", import.meta.url), "utf8");

// One "- ..." block per workflow step.
const steps = wf.slice(wf.indexOf("\n    steps:")).split(/\n(?=      - )/);
const deploys = steps.filter((s) => s.includes("uses: actions/deploy-pages@"));
const idOf = (s) => s.match(/(?:- |\n {8})id: (\w+)/)?.[1];

test("the Pages deploy is attempted three times, each retry only after the previous attempt failed", () => {
  assert.equal(deploys.length, 3);
  const ids = deploys.map(idOf);
  assert.equal(new Set(ids).size, 3);
  for (let i = 1; i < 3; i++) assert.ok(deploys[i].includes(`if: steps.${ids[i - 1]}.outcome == 'failure'`));
});

test("only the last deploy attempt can fail the run", () => {
  assert.match(deploys[0], /continue-on-error: true/);
  assert.match(deploys[1], /continue-on-error: true/);
  assert.doesNotMatch(deploys[2], /continue-on-error/);
});

test("each retry waits first, long enough in total for the artifact to be listed", () => {
  const ids = deploys.map(idOf);
  let total = 0;
  for (let i = 1; i < 3; i++) {
    const wait = steps[steps.indexOf(deploys[i]) - 1];
    assert.ok(wait.includes(`if: steps.${ids[i - 1]}.outcome == 'failure'`));
    total += Number(wait.match(/run: sleep (\d+)/)?.[1]);
  }
  assert.ok(total >= 60, `waits total ${total}s`); // lags of about 46s are reported in actions/deploy-pages#451
});

test("the artifact is uploaded once and the environment url comes from whichever attempt worked", () => {
  assert.equal(steps.filter((s) => s.includes("uses: actions/upload-pages-artifact@")).length, 1);
  const url = wf.match(/url: (.*page_url.*)/)[1];
  for (const id of deploys.map(idOf)) assert.ok(url.includes(`steps.${id}.outputs.page_url`), id);
});
