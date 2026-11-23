import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = fileURLToPath(new URL(".", import.meta.url));
const counts = (day) => `{"v":1,"generatedAt":"${day}T12:00:00.000Z","counts":{"dad-001":[9,1]}}`;

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

/** A bare "remote" plus a work clone that has the scripts, one old snapshot and a gitignore like the real repo. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "snap-"));
  const remote = join(root, "remote.git");
  git(root, "init", "--quiet", "--bare", "--initial-branch=main", remote);
  const seed = join(root, "seed");
  git(root, "clone", "--quiet", remote, seed);
  for (const c of [["user.name", "t"], ["user.email", "t@example.com"]]) git(seed, "config", ...c);
  mkdirSync(join(seed, "scripts")); mkdirSync(join(seed, "history"));
  for (const f of ["publish-snapshot.sh", "snapshot-history.mjs", "build-top.mjs"]) copyFileSync(join(SCRIPTS, f), join(seed, "scripts", f));
  writeFileSync(join(seed, ".gitignore"), "export.json\npublic/counts.json\npublic/top.json\n");
  writeFileSync(join(seed, "history", "2026-11-22.json"), counts("2026-11-22"));
  git(seed, "add", "-A"); git(seed, "commit", "--quiet", "-m", "seed"); git(seed, "push", "--quiet", "origin", "HEAD:main");
  const stale = join(root, "stale");   // what a delayed scheduled run checks out
  git(root, "clone", "--quiet", remote, stale);
  const other = join(root, "other");   // the run that got there first
  git(root, "clone", "--quiet", remote, other);
  for (const d of [stale, other]) for (const c of [["user.name", "t"], ["user.email", "t@example.com"]]) git(d, "config", ...c);
  return { root, remote, stale, other };
}

function runStep(cwd, remote, day, extra = {}) {
  mkdirSync(join(cwd, "public"), { recursive: true });
  writeFileSync(join(cwd, "public", "counts.json"), counts(day));
  return spawnSync("bash", [join(cwd, "scripts", "publish-snapshot.sh"), "public/counts.json", "history"], {
    cwd, encoding: "utf8", env: { ...process.env, REMOTE_URL: remote, GITHUB_REF_NAME: "main", MAX_ATTEMPTS: "2", ...extra },
  });
}

test("stale checkout does not re-create a snapshot a newer run already pushed (the add/add conflict)", () => {
  const { remote, stale, other } = fixture();
  assert.equal(runStep(other, remote, "2026-11-23").status, 0);   // earlier run pushes today's file
  const r = runStep(stale, remote, "2026-11-23");                  // late run, stale tree, same UTC day
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /already on main/);
  assert.equal(git(stale, "rev-parse", "HEAD"), git(other, "rev-parse", "HEAD"));
  assert.equal(git(stale, "status", "--porcelain"), "");
});

test("a stale checkout still pushes when today's snapshot is genuinely missing", () => {
  const { remote, stale } = fixture();
  const r = runStep(stale, remote, "2026-11-23");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(git(stale, "ls-tree", "-r", "--name-only", "HEAD"), /history\/2026-11-23\.json/);
  assert.match(git(stale, "log", "-1", "--format=%s"), /^history: 2026-11-23$/);
});

test("a rejected push resyncs to the remote tip and retries", () => {
  const { remote, stale, other } = fixture();
  // Another run lands a commit between our fetch and push: simulate with a pre-push hook that advances the remote once.
  const hooks = join(stale, ".git", "hooks");
  const flag = join(stale, "..", "raced");
  writeFileSync(join(hooks, "pre-push"),
    `#!/bin/sh\nif [ ! -e "${flag}" ]; then touch "${flag}"; cd "${other}" && echo x > raced.txt && git add raced.txt && git commit -qm raced && git push -q "${remote}" HEAD:main; fi\nexit 0\n`,
    { mode: 0o755 });
  const r = runStep(stale, remote, "2026-11-23");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /rejected; re-syncing/);
  const files = git(stale, "ls-tree", "-r", "--name-only", "HEAD");
  assert.match(files, /raced\.txt/);
  assert.match(files, /history\/2026-11-23\.json/);
});

test("fails loudly when the push can never succeed", () => {
  const { stale } = fixture();
  const r = runStep(stale, join(stale, "..", "remote.git"), "2026-11-23", { MAX_ATTEMPTS: "1" });
  assert.equal(r.status, 0);   // sanity: works with a good remote
  const bad = runStep(stale, "file:///nonexistent/remote.git", "2026-11-24", { MAX_ATTEMPTS: "1" });
  assert.notEqual(bad.status, 0);
});

test("workflow checks out the branch tip and delegates to the script", () => {
  const wf = readFileSync(join(SCRIPTS, "..", ".github", "workflows", "publish-counts.yml"), "utf8");
  assert.match(wf, /ref: \$\{\{ github\.ref_name \}\}/);
  assert.match(wf, /scripts\/publish-snapshot\.sh/);
  assert.doesNotMatch(wf, /git pull --rebase/);
  assert.ok(existsSync(join(SCRIPTS, "publish-snapshot.sh")));
});
