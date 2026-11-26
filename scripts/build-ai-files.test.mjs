import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAiFiles, readSamples, pickJoke, dayIndex, ID, MAX_SAMPLES, APP_STORE_URL, SITE_URL, AI_BOTS,
} from "./build-ai-files.mjs";

const SCRIPT = fileURLToPath(new URL("./build-ai-files.mjs", import.meta.url));
const SAMPLES_FILE = fileURLToPath(new URL("../data/samples.json", import.meta.url));
const CATALOG_FILE = fileURLToPath(new URL("../../../JokeAssembly/Resources/jokes.json", import.meta.url));
const WORKFLOW = fileURLToPath(new URL("../.github/workflows/publish-counts.yml", import.meta.url));
const README = fileURLToPath(new URL("../README.md", import.meta.url));
const samples = JSON.parse(readFileSync(SAMPLES_FILE, "utf8"));
const TEXT = /^[^<>\u0000-\u001f]{1,200}$/;

test("samples.json: about 36 jokes, valid shape, spread over every category", () => {
  const s = readSamples(samples);
  assert.ok(s.length >= 30 && s.length <= 42, `count ${s.length}`);
  assert.ok(s.length <= MAX_SAMPLES);
  assert.equal(new Set(s.map((j) => j.id)).size, s.length, "unique ids");
  assert.ok(new Set(s.map((j) => j.category)).size >= 8, "all categories");
  for (const j of s) {
    assert.deepEqual(Object.keys(j).sort(), ["category", "id", "punchline", "setup"]);
    assert.match(j.id, ID);
    assert.ok(TEXT.test(j.setup) && TEXT.test(j.punchline) && j.category.length <= 30);
  }
});

test("samples.json: every sample is verbatim in the app catalog and stays a small share of it", (t) => {
  if (!existsSync(CATALOG_FILE)) { t.skip("app catalog (JokeAssembly/Resources/jokes.json) not present in this checkout, as in the public cache repo"); return; }
  const catalog = new Map(JSON.parse(readFileSync(CATALOG_FILE, "utf8")).map((j) => [j.id, j]));
  for (const j of samples) assert.deepEqual(catalog.get(j.id), j, `${j.id} matches the catalog verbatim`);
  assert.ok(samples.length / catalog.size <= 0.15, "samples are at most 15% of the catalog");
});

test("readSamples rejects malformed input", () => {
  const ok = { id: "dad-001", category: "Dad", setup: "Setup?", punchline: "Punch." };
  assert.equal(readSamples([ok]).length, 1);
  for (const bad of [
    null, {}, [], "x", [{ ...ok, id: "Dad-1" }], [{ ...ok, extra: 1 }], [{ ...ok, setup: "" }], [{ ...ok, setup: "a".repeat(201) }],
    [{ ...ok, punchline: "<b>hi</b>" }], [{ ...ok, category: 5 }], [{ ...ok, category: "" }], [ok, ok], [{ id: "dad-001" }],
    Array.from({ length: MAX_SAMPLES + 1 }, (_, i) => ({ ...ok, id: `dad-${String(i).padStart(3, "0")}` })),
  ]) assert.throws(() => readSamples(bad), /invalid samples/);
});

test("dayIndex counts UTC days and rejects bad dates", () => {
  assert.equal(dayIndex("1970-01-01"), 0);
  assert.equal(dayIndex("1970-01-02"), 1);
  assert.equal(dayIndex("2026-10-14") - dayIndex("2026-10-13"), 1);
  for (const bad of ["2026-13-01", "2026-02-30", "26-10-14", "", "2026-10-14T00:00:00Z"]) assert.throws(() => dayIndex(bad), /invalid date/);
});

test("joke of the day is deterministic, rotates through every sample and never repeats on consecutive days", () => {
  const s = readSamples(samples);
  assert.deepEqual(pickJoke(s, "2026-10-14"), pickJoke(s, "2026-10-14"));
  const seen = new Set();
  let prev = null;
  for (let d = dayIndex("2026-10-01"); d < dayIndex("2026-10-01") + s.length * 3; d++) {
    const day = new Date(d * 86_400_000).toISOString().slice(0, 10);
    const j = pickJoke(s, day);
    assert.notEqual(j.id, prev, `repeat on ${day}`);
    prev = j.id; seen.add(j.id);
  }
  assert.equal(seen.size, s.length, "each sample appears");
  const single = [s[0]];
  assert.equal(pickJoke(single, "2026-10-14").id, s[0].id);
});

test("buildAiFiles returns exactly the expected files", () => {
  const f = buildAiFiles(samples, "2026-10-14");
  assert.deepEqual([...f.keys()].sort(), ["jokes.json", "joke-of-the-day.json", "llms.txt", "openapi.json", "robots.txt", "sitemap.xml"].sort());
  for (const v of f.values()) assert.equal(typeof v, "string");
});

test("joke-of-the-day.json: schema, source and license", () => {
  const j = JSON.parse(buildAiFiles(samples, "2026-10-14").get("joke-of-the-day.json"));
  assert.deepEqual(Object.keys(j).sort(), ["category", "date", "id", "punchline", "setup", "source"]);
  assert.equal(j.date, "2026-10-14");
  assert.match(j.id, ID);
  assert.ok(samples.some((s) => s.id === j.id && s.setup === j.setup && s.punchline === j.punchline && s.category === j.category));
  assert.deepEqual(Object.keys(j.source).sort(), ["license", "name", "url"]);
  assert.equal(j.source.name, "Joke Assembly");
  assert.equal(j.source.url, APP_STORE_URL);
  assert.match(j.source.url, /^https:\/\/apps\.apple\.com\//);
  assert.equal(j.source.license, "One joke per day for personal/AI assistant use, please link to the app.");
  assert.ok(TEXT.test(j.setup) && TEXT.test(j.punchline));
});

test("jokes.json: only the sample list, labelled as a sample, never more than the sample set", () => {
  const j = JSON.parse(buildAiFiles(samples, "2026-10-14").get("jokes.json"));
  assert.deepEqual(Object.keys(j).sort(), ["count", "jokes", "note", "sample", "source"]);
  assert.equal(j.sample, true);
  assert.equal(j.count, j.jokes.length);
  assert.ok(j.jokes.length <= samples.length && j.jokes.length <= MAX_SAMPLES);
  assert.deepEqual(j.jokes, samples);
  assert.match(j.note, /sample/i);
  assert.match(j.note, /not the full catalog/i);
  assert.equal(j.source.url, APP_STORE_URL);
});

test("no output carries user, device, Lounge or usage data", () => {
  const all = [...buildAiFiles(samples, "2026-10-14").values()].join("\n");
  for (const word of ["requestsUsed", "writeUnitsUsed", "purgeBacklog", "EXPORT_KEY", "token", "deviceId"]) assert.equal(all.includes(word), false, word);
  assert.match(all, /no Lounge/i);
});

test("openapi.json: valid-looking OpenAPI 3.1 for every published GET file", () => {
  const o = JSON.parse(buildAiFiles(samples, "2026-10-14").get("openapi.json"));
  assert.equal(o.openapi, "3.1.0");
  assert.equal(o.info.title, "Joke Assembly static data");
  assert.deepEqual(o.servers, [{ url: SITE_URL }]);
  assert.deepEqual(Object.keys(o.paths).sort(), ["/counts.json", "/joke-of-the-day.json", "/jokes.json", "/top.json"]);
  for (const [path, item] of Object.entries(o.paths)) {
    assert.deepEqual(Object.keys(item), ["get"], path);
    assert.ok(item.get.operationId && item.get.summary, path);
    assert.ok(item.get.responses["200"].content["application/json"].schema, path);
  }
  const text = JSON.stringify(o);
  for (const ref of text.match(/#\/components\/schemas\/\w+/g) ?? []) assert.ok(o.components.schemas[ref.split("/").pop()], ref);
  assert.ok(o.components.schemas.Joke.required.includes("punchline"));
});

test("llms.txt: concise, lists every endpoint, caveats, attribution, contact", () => {
  const t = buildAiFiles(samples, "2026-10-14").get("llms.txt");
  assert.ok(t.startsWith("# Joke Assembly\n"));
  assert.ok(t.length < 5000, "concise");
  for (const p of ["/joke-of-the-day.json", "/jokes.json", "/top.json", "/counts.json", "/openapi.json"]) assert.ok(t.includes(`${SITE_URL}${p}`), p);
  assert.match(t, /anonymous aggregate/i);
  assert.match(t, /check generatedAt/);
  assert.match(t, /week of snapshots/);
  assert.match(t, /link to the app/i);
  assert.ok(t.includes("https://shapehaveninnovations.com"));
  assert.match(t, /no Lounge/i);
  assert.match(t, /not the full catalog/i);
  assert.equal(/<[a-z]/i.test(t), false, "no HTML");
});

test("robots.txt allows the AI crawlers explicitly and names the sitemap", () => {
  const t = buildAiFiles(samples, "2026-10-14").get("robots.txt");
  assert.deepEqual(AI_BOTS, ["GPTBot", "ClaudeBot", "anthropic-ai", "PerplexityBot", "Google-Extended", "CCBot", "Applebot-Extended"]);
  for (const bot of AI_BOTS) assert.ok(t.includes(`User-agent: ${bot}\nAllow: /\n`), bot);
  assert.ok(t.includes(`Sitemap: ${SITE_URL}/sitemap.xml`));
  assert.equal(/Disallow: \//.test(t), false);
});

test("sitemap.xml lists the files with the build date", () => {
  const t = buildAiFiles(samples, "2026-10-14").get("sitemap.xml");
  assert.ok(t.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
  for (const p of ["/llms.txt", "/openapi.json", "/joke-of-the-day.json", "/jokes.json", "/top.json", "/counts.json"]) assert.ok(t.includes(`<loc>${SITE_URL}${p}</loc>`), p);
  assert.ok(t.includes("<lastmod>2026-10-14</lastmod>"));
});

test("output is identical for the same date and changes the joke the next day", () => {
  const a = buildAiFiles(samples, "2026-10-14"), b = buildAiFiles(samples, "2026-10-14"), c = buildAiFiles(samples, "2026-10-15");
  for (const [k, v] of a) assert.equal(b.get(k), v);
  assert.notEqual(a.get("joke-of-the-day.json"), c.get("joke-of-the-day.json"));
  assert.equal(a.get("jokes.json"), c.get("jokes.json"));
});

test("the real App Store URL lives in one constant and the README documents it", () => {
  const src = readFileSync(SCRIPT, "utf8");
  assert.equal(src.split(APP_STORE_URL).length - 1, 1, "the URL literal appears once");
  assert.equal(APP_STORE_URL, "https://apps.apple.com/us/app/joke-assembly/id6502868916");
  assert.doesNotMatch(src, /id0000000000|OWNER: replace/, "no placeholder left");
  assert.match(readFileSync(README, "utf8"), /APP_STORE_URL/);
});

test("CLI writes the files, defaults to the clock, and fails closed on bad input", () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-"));
  const out = join(dir, "public");
  const r = spawnSync(process.execPath, [SCRIPT, SAMPLES_FILE, out, "2026-10-14"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(out).sort(), ["joke-of-the-day.json", "jokes.json", "llms.txt", "openapi.json", "robots.txt", "sitemap.xml"]);
  assert.equal(JSON.parse(readFileSync(join(out, "joke-of-the-day.json"), "utf8")).date, "2026-10-14");
  const out2 = join(dir, "public2");
  assert.equal(spawnSync(process.execPath, [SCRIPT, SAMPLES_FILE, out2], { encoding: "utf8" }).status, 0);
  assert.match(JSON.parse(readFileSync(join(out2, "joke-of-the-day.json"), "utf8")).date, /^\d{4}-\d{2}-\d{2}$/);
  writeFileSync(join(dir, "bad.json"), "[]");
  const out3 = join(dir, "public3");
  assert.notEqual(spawnSync(process.execPath, [SCRIPT, join(dir, "bad.json"), out3], { encoding: "utf8" }).status, 0);
  assert.equal(existsSync(out3), false, "nothing is written on failure");
  assert.notEqual(spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" }).status, 0);
});

test("workflow: the AI files step runs after the other builds and before the upload, with no secrets and no network", () => {
  const yml = readFileSync(WORKFLOW, "utf8");
  const cmd = "node scripts/build-ai-files.mjs data/samples.json public";
  const at = yml.indexOf(cmd);
  assert.ok(at > 0, "build step exists");
  assert.ok(at > yml.indexOf("node scripts/build-top.mjs"), "after top.json");
  assert.ok(at > yml.indexOf("node scripts/build-counts.mjs"), "after counts.json");
  assert.ok(at < yml.indexOf("actions/upload-pages-artifact"), "before the upload");
  assert.ok(new RegExp(`${cmd.replace(/\./g, "\\.")}[^\\n]*\\|\\| echo "::warning::`).test(yml), "never blocks counts");
  const start = yml.lastIndexOf("- name:", at);
  const step = yml.slice(start, yml.indexOf("\n      - ", at));
  assert.equal(/secrets\.|github\.token|EXPORT_KEY|EXPORT_URL|curl|fetch|\benv:/.test(step), false, "no secrets, env or network in the step");
  assert.ok(/path: public\b/.test(yml), "the artifact is still public/ only");
  assert.equal(/path:\s*(\.|history|export)/.test(yml), false, "history/ and export.json are not uploaded");
  assert.equal(yml.includes("data/samples.json public/"), false);
});
