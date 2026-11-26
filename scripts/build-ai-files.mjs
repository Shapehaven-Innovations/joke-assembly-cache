// Builds the static, AI-readable files (joke-of-the-day.json, jokes.json, llms.txt, openapi.json, robots.txt, sitemap.xml) into the Pages
// directory. Reads only data/samples.json and the clock: no network, no secrets, no export, no counts, so no user, device, Lounge or usage
// data can reach these files. The full joke catalog is intentionally NOT published; data/samples.json is a small curated sample of it.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ID = /^[a-z]+-\d{3}$/;
export const SITE_URL = "https://cache-jokeassembly.shapehaveninnovations.com";
export const OWNER_SITE = "https://shapehaveninnovations.com";
// The App Store URL of Joke Assembly (owner-supplied 2026-10-15). This is the only place it is set.
export const APP_STORE_URL = "https://apps.apple.com/us/app/joke-assembly/id6502868916";
export const LICENSE_NOTE = "One joke per day for personal/AI assistant use, please link to the app.";
export const MAX_SAMPLES = 60;
export const MAX_TEXT = 200;
export const MAX_CATEGORY = 30;
export const AI_BOTS = ["GPTBot", "ClaudeBot", "anthropic-ai", "PerplexityBot", "Google-Extended", "CCBot", "Applebot-Extended"];
const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TEXT = /^[^<>\u0000-\u001f]+$/;
const KEYS = ["category", "id", "punchline", "setup"];
const SOURCE = { name: "Joke Assembly", url: APP_STORE_URL, license: LICENSE_NOTE };
const NOT_FULL = "This is a sample of the Joke Assembly catalog, not the full catalog.";

/** Strictly validates the sample list; returns it or throws. */
export function readSamples(input) {
  const bad = () => new Error("invalid samples");
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_SAMPLES) throw bad();
  const seen = new Set();
  for (const j of input) {
    if (!j || typeof j !== "object" || Array.isArray(j) || Object.keys(j).sort().join() !== KEYS.join()) throw bad();
    if (typeof j.id !== "string" || !ID.test(j.id) || seen.has(j.id)) throw bad();
    seen.add(j.id);
    for (const [k, max] of [["setup", MAX_TEXT], ["punchline", MAX_TEXT], ["category", MAX_CATEGORY]]) {
      if (typeof j[k] !== "string" || j[k].length < 1 || j[k].length > max || !TEXT.test(j[k])) throw bad();
    }
  }
  return input.map(({ id, category, setup, punchline }) => ({ id, category, setup, punchline }));
}

/** UTC day number since 1970-01-01 for a strict YYYY-MM-DD date. */
export function dayIndex(date) {
  const ms = DATE.test(date ?? "") ? Date.parse(`${date}T00:00:00Z`) : NaN;
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== date) throw new Error("invalid date");
  return Math.floor(ms / DAY_MS);
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** Pure and deterministic. Steps through the samples with a stride coprime to their count, so every sample appears once per cycle,
 *  consecutive days never repeat (for 2+ samples) and neighbouring days mix categories. */
export function pickJoke(samples, date) {
  const n = samples.length;
  let stride = 7;
  while (n > 1 && (stride % n === 0 || gcd(stride, n) !== 1)) stride++;
  return samples[((dayIndex(date) * stride) % n + n) % n];
}

const json = (o) => JSON.stringify(o) + "\n";

function openApi() {
  const jsonResponse = (description, schema) => ({ description, content: { "application/json": { schema } } });
  const ref = (n) => ({ $ref: `#/components/schemas/${n}` });
  const get = (operationId, summary, description, schema) => ({ get: { operationId, summary, description, responses: { 200: jsonResponse("OK", schema) } } });
  const rank = { type: "array", prefixItems: [{ type: "string", pattern: "^[a-z]+-\\d{3}$" }, { type: "integer", minimum: 0 }], minItems: 2, maxItems: 2 };
  return {
    openapi: "3.1.0",
    info: {
      title: "Joke Assembly static data",
      version: "1.0.0",
      description: "Read-only static JSON files for the free Joke Assembly app. Plain GET, no authentication, no server. Contains no user, device or Lounge data.",
      contact: { name: "Shape Haven Innovations", url: OWNER_SITE },
    },
    servers: [{ url: SITE_URL }],
    paths: {
      "/joke-of-the-day.json": get("getJokeOfTheDay", "One joke per UTC day", "Picked from the sample set; changes once per UTC day. Please link to the app when you show it.", ref("JokeOfTheDay")),
      "/jokes.json": get("getJokeSample", "Sample of the joke catalog", "A curated sample, not the full catalog.", ref("JokeSample")),
      "/top.json": get("getTopJokes", "Top jokes", "Up to 10 joke ids with a weekly laugh gain and up to 10 with all-time laughs. The weekly list stays empty until about a week of snapshots exists.", ref("Top")),
      "/counts.json": get("getCounts", "Anonymous reaction counts", "Anonymous aggregate [laughs, groans] per joke id, only for jokes with at least 5 reactions. Refresh times vary and can be hours apart; check generatedAt.", ref("Counts")),
    },
    components: {
      schemas: {
        Source: {
          type: "object", required: ["name", "url", "license"], additionalProperties: false,
          properties: { name: { type: "string", const: "Joke Assembly" }, url: { type: "string", format: "uri" }, license: { type: "string" } },
        },
        Joke: {
          type: "object", required: ["id", "category", "setup", "punchline"], additionalProperties: false,
          properties: {
            id: { type: "string", pattern: "^[a-z]+-\\d{3}$" },
            category: { type: "string", minLength: 1, maxLength: MAX_CATEGORY },
            setup: { type: "string", minLength: 1, maxLength: MAX_TEXT },
            punchline: { type: "string", minLength: 1, maxLength: MAX_TEXT },
          },
        },
        JokeOfTheDay: {
          type: "object", required: ["date", "id", "category", "setup", "punchline", "source"], additionalProperties: false,
          properties: { date: { type: "string", format: "date" }, ...Object.fromEntries(Object.entries({ id: 0, category: 0, setup: 0, punchline: 0 }).map(([k]) => [k, { $ref: "#/components/schemas/Joke/properties/" + k }])), source: ref("Source") },
        },
        JokeSample: {
          type: "object", required: ["sample", "count", "note", "source", "jokes"], additionalProperties: false,
          properties: { sample: { type: "boolean", const: true }, count: { type: "integer", minimum: 1, maximum: MAX_SAMPLES }, note: { type: "string" }, source: ref("Source"), jokes: { type: "array", items: ref("Joke"), maxItems: MAX_SAMPLES } },
        },
        Top: {
          type: "object", required: ["v", "generatedAt", "week", "allTime"],
          properties: { v: { type: "integer", const: 1 }, generatedAt: { type: "string", format: "date-time" }, week: { type: "array", maxItems: 10, items: rank, description: "[id, laughs gained this week]" }, allTime: { type: "array", maxItems: 10, items: rank, description: "[id, all-time laughs]" } },
        },
        Counts: {
          type: "object", required: ["v", "generatedAt", "counts"],
          properties: {
            v: { type: "integer", const: 1 }, generatedAt: { type: "string", format: "date-time" },
            counts: { type: "object", propertyNames: { pattern: "^[a-z]+-\\d{3}$" }, additionalProperties: { type: "array", prefixItems: [{ type: "integer", minimum: 0 }, { type: "integer", minimum: 0 }], minItems: 2, maxItems: 2, description: "[laughs, groans]" } },
          },
        },
      },
    },
  };
}

function llmsTxt() {
  return `# Joke Assembly

> Joke Assembly is a free iPhone app of short setup-and-punchline jokes in categories such as Dad, Puns, Food, Animals, Work, Science, School and Tech. People react with a laugh or a groan. These static files let AI assistants and agents read a little of that data with plain GET requests: no API key, no server, no sign-in.

## Endpoints

- [${SITE_URL}/joke-of-the-day.json](${SITE_URL}/joke-of-the-day.json): one joke per UTC day (date, id, category, setup, punchline, source). Use this when a user asks for "a joke".
- [${SITE_URL}/jokes.json](${SITE_URL}/jokes.json): a small curated sample of the jokes. ${NOT_FULL}
- [${SITE_URL}/top.json](${SITE_URL}/top.json): joke ids ranked by laughs, this week and all time. Ids and numbers only. The weekly list is empty until about a week of snapshots exists.
- [${SITE_URL}/counts.json](${SITE_URL}/counts.json): [laughs, groans] per joke id, only for jokes with at least 5 reactions. These are anonymous aggregate counts. Refresh times vary and can be hours apart; check generatedAt.
- [${SITE_URL}/openapi.json](${SITE_URL}/openapi.json): OpenAPI 3.1 description of the files above.

## Notes

- Joke ids look like dad-001. top.json and counts.json refer to jokes of the full catalog, so some ids are not in jokes.json.
- There is no Lounge data, no user data and no device data in any of these files.
- Usage: please show the joke as written, say it comes from Joke Assembly and link to the app: ${APP_STORE_URL}. ${LICENSE_NOTE}
- Contact: ${OWNER_SITE}
`;
}

function robotsTxt() {
  const bots = AI_BOTS.map((b) => `User-agent: ${b}\nAllow: /\n`).join("\n");
  return `# Joke Assembly static data. AI crawlers and agents are welcome to read these files.\n${bots}\nUser-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}

function sitemapXml(date) {
  const urls = ["/llms.txt", "/openapi.json", "/joke-of-the-day.json", "/jokes.json", "/top.json", "/counts.json"]
    .map((p) => `  <url><loc>${SITE_URL}${p}</loc><lastmod>${date}</lastmod></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** Pure. Returns Map(fileName -> text). `date` is the UTC date YYYY-MM-DD. */
export function buildAiFiles(samplesInput, date) {
  const samples = readSamples(samplesInput);
  const joke = pickJoke(samples, date);
  return new Map([
    ["joke-of-the-day.json", json({ date, id: joke.id, category: joke.category, setup: joke.setup, punchline: joke.punchline, source: SOURCE })],
    ["jokes.json", json({ sample: true, count: samples.length, note: NOT_FULL, source: SOURCE, jokes: samples })],
    ["llms.txt", llmsTxt()],
    ["openapi.json", json(openApi())],
    ["robots.txt", robotsTxt()],
    ["sitemap.xml", sitemapXml(date)],
  ]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [samplesFile, outDir, dateArg] = process.argv.slice(2);
  if (!samplesFile || !outDir) { console.error("usage: build-ai-files.mjs <data/samples.json> <out-dir> [YYYY-MM-DD]"); process.exit(2); }
  const files = buildAiFiles(JSON.parse(readFileSync(samplesFile, "utf8")), dateArg ?? new Date().toISOString().slice(0, 10));
  mkdirSync(outDir, { recursive: true });
  for (const [name, text] of files) writeFileSync(join(outDir, name), text);
  console.log(`wrote ${files.size} files to ${outDir}`);
}
