# joke-assembly-cache

## What this is

This repository publishes the public, aggregate reaction counts (laughs and groans per joke) for the free Joke Assembly app. It serves two small files through GitHub Pages: `counts.json` (joke ids and two totals per joke) and `top.json` (the app's "Top jokes": up to 10 joke ids with a weekly laugh gain and up to 10 with all-time laughs; ids and integers only). `history/` holds one copy of `counts.json` per UTC day (newest 8, only jokes with 5+ reactions, never the raw export, never the usage block); it is not published. It contains no personal data, no user identifiers and no per-device information. This is not a commercial service and nothing here is sold or monetised; it exists only so the free app can show how other people reacted to a joke without every device querying the backend directly.

A scheduled GitHub Action calls the backend's private export endpoint with a key, runs `scripts/build-counts.mjs` to validate and trim the data, runs `scripts/build-top.mjs` to build `top.json`, and deploys the result to Pages.

## One-time setup (owner)

1. Create a new public repository named `joke-assembly-cache` under your account or organisation, and copy the contents of this folder (including the hidden `.github/` and `.gitignore`) to the root of that repository. Push to the default branch.
2. In the repository go to Settings > Pages and set Source to "GitHub Actions".
3. Recommended first: verify the domain at account level (your account or organisation Settings > Pages > Add a domain, then add the TXT record GitHub shows). Verification stops other accounts from taking over the domain if the Pages site is ever removed. Then, in the repository's Settings > Pages, set Custom domain to `cache-jokeassembly.shapehaveninnovations.com`, save, and tick "Enforce HTTPS" once the certificate has been issued (this can take a few minutes after DNS resolves).
4. In your DNS zone for `shapehaveninnovations.com`, add a CNAME record with name `cache-jokeassembly` pointing to `<account-or-org>.github.io`, where `<account-or-org>` is the GitHub user or organisation that owns the repo. If the zone is on Cloudflare, set the record to "DNS only" (grey cloud), not proxied, so GitHub can issue the certificate.
5. Go to Settings > Secrets and variables > Actions. Under Secrets add a repository secret `EXPORT_KEY` whose value is identical to the Worker's `EXPORT_KEY` secret. Under Variables add a repository variable `EXPORT_URL` with the value `https://<worker-host>/internal/export`, where `<worker-host>` is the hostname of the deployed Lounge Worker.
6. Open the Actions tab, choose the `publish-counts` workflow and click "Run workflow" to publish the first snapshot. After that it runs automatically every 30 minutes.

## Usage alert (the Free plan has no notifications)

The Worker's export response also carries a `usage` block (requests used and the daily guard budget, D1 write units used and the daily write cap). It is never copied into `counts.json`: `scripts/build-counts.mjs` reads only `v`, `generatedAt` and `counts`. As its last step the workflow runs `scripts/check-usage.mjs`, which fails the run (exit 1, with an `::error::` message naming the number and the limit) when requests used pass 70% of the budget or write units pass 70% of the cap, or when the export has no usable usage block. GitHub emails the owner about a failed run, so make sure failed-workflow emails are on (GitHub Settings, Notifications, Actions). The counts are published before this step, so an alert never delays them. The `usage` block may also carry `windows` (per-Joke-Hour peak members, joins and rooms, no ids; see the Lounge README): `check-usage.mjs` prints them to the Action log and nothing writes them to a published file. The export may also report `purgeBacklog: true` (the automatic cleanup of old ids still has work waiting after its pass); the check then prints a warning and the run still passes. A flag that stays true run after run means the cleanup is not keeping up. While usage stays over 70%, EVERY run fails, up to 48 emails a day (one per 30-minute run). To silence it, bring the usage down (lower `GUARD_SHARE_PERCENT` or `LOUNGE_BUDGET_PERCENT` / `LOUNGE_MAX_ROOMS` and redeploy, or wait for 00:00 UTC when the counters reset), raise the thresholds in `scripts/check-usage.mjs` (`THRESHOLD`), or turn off failed-run emails in GitHub for this repository.

## Top jokes (top.json)

`scripts/build-top.mjs` builds `public/top.json` from the published `counts.json` and the daily snapshots in `history/`. It reads only `v`, `generatedAt` and `counts`, so the export's usage block can never reach it. Thresholds (owner decision D2; raise them in the script without an app update): `MIN_TOTAL = 5` total reactions to be listed at all, and `MIN_WEEK_GAIN = 3` laughs gained to be listed for the week.

The weekly gain compares today's laughs with the snapshot dated 7 days earlier (else 6, else 8 days earlier; with none, the weekly list is empty). A joke that is not in the baseline had fewer than 5 reactions then, so its gain is computed as `laughs - 4` (a lower bound). Negative gains clamp to 0. Both lists are capped at 10 rows. If building `top.json` fails, the step only prints a warning: `counts.json` is still published. The first weekly list appears 6-7 days after the first snapshot.

## Verify

Run:

```
curl -s https://cache-jokeassembly.shapehaveninnovations.com/counts.json
curl -s https://cache-jokeassembly.shapehaveninnovations.com/top.json
```

The response should be JSON beginning `{"v":1,...` with a `generatedAt` timestamp and a `counts` object. The app shows counts after its next refresh (it only shows a joke's counts once that joke has at least 5 reactions).

## If GitHub flags or removes the repo, Pages or the Action (runbook)

The app already protects itself: after two failed fetches of the static file it falls back to the Worker's `/v1/counts` endpoint, at most once every 2 hours per device, and a miss on that endpoint is protected by the Worker's daily budget guard (a cached copy is served before the guard, so hits are not counted by it, though they are still Worker requests on the account). So an outage here degrades freshness but does not break the app.

To move to another host with no app release:

1. Keep `scripts/build-counts.mjs`, `scripts/build-top.mjs` and `scripts/snapshot-history.mjs` unchanged. The export and build steps stay the same on any host.
2. If the new host is a new repository or a different CI system, re-create the `EXPORT_KEY` secret and the `EXPORT_URL` variable there; they do not carry over. In the workflow, replace only the last three steps (`actions/configure-pages`, `actions/upload-pages-artifact`, `actions/deploy-pages`) with the new host's static-deploy step. For example, Cloudflare Pages with `wrangler pages deploy public --project-name <name>` (needs the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`), GitLab Pages (publish the `public` directory as the pages artifact), or Netlify (deploy the `public` directory). Add whatever credentials that host needs as repository or CI secrets, and remove the `pages: write` / `id-token: write` permissions and the `github-pages` environment if they are no longer needed.
3. Point a hostname at the new host and confirm both `counts.json` and `top.json` are served over HTTPS (the app derives the `top.json` URL from the first non-Worker `counts.json` source).
4. Set the Worker variable `COUNTS_SOURCES` to the new URL. It accepts a comma-separated list, primary first, so you can keep the old URL second while it still works. Redeploy the Worker.
5. The app picks up the new source from `/v1/config` within an hour; no app update is required.

## Why the file stays small and polite

Only jokes with at least 5 reactions are published, which keeps `counts.json` to a few KB and avoids exposing very small, easily identifiable samples. Entries that are malformed (bad ids, negative or non-integer numbers) are dropped by the builder instead of being published. The app fetches the file with a plain GET (an ephemeral URLSession with no persistent HTTP cache, so no ETag revalidation) at most every 30 minutes per device, and the workflow refreshes it only every 30 minutes, so the load on GitHub Pages is light.

## Keeping the schedule alive (60-day rule)

GitHub automatically disables scheduled workflows in a public repository when there has been no repository activity for 60 days. The daily snapshot step prevents that: it commits `history/YYYY-MM-DD.json` once a UTC day (message "history: 2026-10-13", authored by `github-actions[bot]`, no trailers). That is about 365 small commits a year, which keeps the repository active so the 60-day rule never triggers (owner decision D4). The step is skipped on forks and runs after the Pages deploy, so a failed push never delays `counts.json` or `top.json`. A failed push fails the run (the owner is emailed) and the next run retries, because today's file is still missing. Pushes made with the workflow token start no new run, and the concurrency group `pages` with `cancel-in-progress: false` serialises runs. This is why the job has `contents: write` permission.

If the schedule is ever disabled anyway, open the Actions tab, choose the `publish-counts` workflow and click "Enable workflow", or simply push any commit.

If the publisher stops, the app does not break: once the file is more than 6 hours stale it falls back to the Worker's `/v1/counts`. That degrades gracefully but spends Worker budget, so restore the publisher soon.
