# scraper-service

A Python sidecar that does one thing: **hand back the HTML a real browser would
have seen.** Built on [Scrapling](https://github.com/D4Vinci/Scrapling).

Four platform adapters in this repo cannot be served by a plain HTTP GET:

| Platform | Why | How this service is called |
| --- | --- | --- |
| `hackerearth` | JS-rendered; the numbers are not in the served HTML | `wait_for` = a content selector |
| `interviewbit` | JS-rendered | `wait_for` = a content selector |
| `code360` | JS-rendered SPA, state arrives in a bootstrap blob | `settle_ms: 1500`, no `wait_for` |
| `spoj` | 403 Cloudflare interstitial, even from a residential IP | `solve_cloudflare: true` |

Everything else — scheduling, per-platform throttling, the circuit breaker,
retry counting, cursors, and **all parsing** — already lives in TypeScript
(`src/lib/platform-worker.server.ts`, `src/lib/platforms/*`). This service adds
the single capability that stack cannot have inside a serverless function: a
browser. It is deliberately not a crawling framework. It returns raw HTML and
nothing else.

The TypeScript client is `src/lib/platforms/render.ts`. **That file is the
contract.** This service matches it; do not change it to match this service.

---

## The contract

### `POST /fetch`

```
Authorization: Bearer <SCRAPLING_TOKEN>       # only when the token is configured
Content-Type: application/json

{
  "url":              "https://www.spoj.com/users/someuser/",
  "wait_for":         ".profile-header",   // CSS selector, or null
  "solve_cloudflare": false,
  "settle_ms":        0
}
```

| Situation | HTTP | Body | `render.ts` raises |
| --- | --- | --- | --- |
| Page rendered | `200` | `{"html": "<...>", "status": 200}` | — (returns `html`) |
| Upstream said 404 | `404` | `{"status": 404}` | `not_found` |
| Reached the site, could not read it | `200` | `{"error": "...", "status": <n>}` | `throttle` |
| Browser failed to launch | `503` | `{"error": "...", "status": 503}` | `throttle` |
| Bad / missing bearer token | `401` | `{"error": "unauthorized", ...}` | `fail` |
| Malformed body or non-http URL | `400` / `422` | `{"error": ...}` | `fail` |

Two details worth understanding before changing anything:

- **Not-found answers with HTTP 404 *and* `"status": 404` in the body.**
  `render.ts` tests `res.status === 404` first and `parsed.status === 404`
  later; satisfying both means the classification never depends on which check
  wins.
- **"Blocked" is an HTTP 200 with an `error` key, not an HTTP error.** That is
  what makes `render.ts` raise `throttle` instead of `fail`, so the worker backs
  off *the platform* rather than marking a perfectly good student handle as
  invalid. This asymmetry is the whole point of the shape.

Note that not-found is mostly decided in TypeScript, on page *content* — SPOJ
and Code360 both answer `200` for a handle that does not exist. The `404` path
here only fires when the upstream site itself returns 404.

### `GET /health`

```json
{
  "status": "ok",
  "auth": true,
  "max_pages": 2,
  "max_concurrency": 2,
  "browsers": {
    "dynamic": {"running": true, "inflight": 0, "uses": 12, "max_uses": 60, "starts": 1},
    "stealth": {"running": false, "inflight": 0, "uses": 0,  "max_uses": 60, "starts": 0}
  }
}
```

Never launches a browser, so it is safe as a 5-second platform healthcheck.
`browsers.*.starts` climbing steadily is the signal that something is crashing
or that `SCRAPLING_SESSION_MAX_USES` is set too low.

---

## curl

```bash
# JS-rendered page, wait for a selector
curl -sS -X POST http://localhost:8000/fetch \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $SCRAPLING_TOKEN" \
  -d '{
        "url": "https://www.hackerearth.com/@someuser",
        "wait_for": "[class*=profile]",
        "solve_cloudflare": false,
        "settle_ms": 0
      }' | head -c 400

# Cloudflare-gated page (slow: budget ~25-55s)
curl -sS -X POST http://localhost:8000/fetch \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $SCRAPLING_TOKEN" \
  -d '{
        "url": "https://www.spoj.com/users/someuser/",
        "wait_for": null,
        "solve_cloudflare": true,
        "settle_ms": 0
      }' | head -c 400

curl -sS http://localhost:8000/health
```

---

## Run locally

Python 3.10+ (3.12 recommended).

```bash
cd scraper-service
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# One-time: downloads Chromium + system deps (~400MB). Needs sudo on Linux for
# the system libraries; on macOS/Windows it just downloads.
scrapling install
python -m patchright install chromium      # the stealth build, for solve_cloudflare

cp .env.example .env      # then set SCRAPLING_TOKEN
set -a && . ./.env && set +a

uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1
```

Set `SCRAPLING_HEADLESS=false` to watch the browser work — the fastest way to
find out why a `wait_for` selector never resolves.

Or with Docker:

```bash
docker build -t scraper-service .
docker run --rm -p 8000:8000 -e SCRAPLING_TOKEN=dev-token scraper-service
```

Then point the app at it:

```bash
SCRAPLING_URL=http://localhost:8000
SCRAPLING_TOKEN=dev-token
```

---

## Deploy

**This needs a persistent host — Fly.io, Railway, Render, or a plain VPS. It
cannot run on Vercel serverless.** Three independent reasons:

1. **Size.** Chromium alone is ~400MB unpacked; the built image is ~1.3GB.
   Vercel's serverless function bundle limit is 250MB uncompressed.
2. **Cold start.** A serverless container that does not keep a browser resident
   pays a full Chromium launch (2-5s) on top of the page load, on every request
   — inside a call the client has already given a 30s deadline. The entire
   memory strategy here (see below) depends on the process *staying alive*
   between requests; a scale-to-zero runtime deletes that benefit.
3. **Wall clock.** A Cloudflare solve routinely takes 15-25s and this service
   allows up to 55s. That exceeds the default execution limit on most
   serverless tiers.

### Fly.io

```bash
cd scraper-service
fly launch --no-deploy --name kenitic-scraper     # writes fly.toml
fly secrets set SCRAPLING_TOKEN="$(openssl rand -hex 32)"
fly scale vm shared-cpu-1x --memory 1024          # 512MB is not enough for Chromium
fly deploy
fly logs
```

In `fly.toml`, set `internal_port = 8000`, add an HTTP healthcheck on
`/health`, and **leave `auto_stop_machines` off** — or accept a cold browser
launch on the first request after every idle period. If you do enable it, raise
`SCRAPLING_HARD_TIMEOUT_MS` to cover the machine wake.

### Railway / Render

Point the service at `scraper-service/` as the build root; both detect the
Dockerfile. Set `SCRAPLING_TOKEN`, leave `PORT` to the platform, add a health
check on `/health`, and pick an instance with **at least 1GB RAM**.

### Then, on the app

Set these two on the Kenitic Tracker Hub deployment (Vercel env vars, and any
GitHub Actions runner that executes the worker):

| Variable | Value |
| --- | --- |
| `SCRAPLING_URL` | `https://kenitic-scraper.fly.dev` — base URL, no trailing `/fetch` |
| `SCRAPLING_TOKEN` | byte-identical to the sidecar's `SCRAPLING_TOKEN` |

`render.ts` appends `/fetch` itself and strips trailing slashes from
`SCRAPLING_URL`. Until `SCRAPLING_URL` is set, `hasRenderer()` is false and the
four adapters above fail with an error that names the missing renderer — which
is the honest outcome, not a bug.

---

## Memory and concurrency

A Chromium per request exhausts a small box almost immediately. The mitigations,
in order of how much they matter:

- **At most two browser *processes*, ever** — one plain Chromium
  (`AsyncDynamicSession`) and one stealth build (`AsyncStealthySession`), held
  for the life of the service instead of launched per request. Both start
  lazily, so a deployment that never sends `solve_cloudflare: true` never pays
  for the second one. Per-request options (`wait_for`, `settle_ms`,
  `solve_cloudflare`) still work because Scrapling's `session.fetch()` takes
  per-call overrides.
- **Tabs, not processes, for concurrency.** `SCRAPLING_MAX_PAGES` caps
  concurrent tabs; a semaphore of the same size gates admission, so nothing ever
  queues inside Scrapling's own pool — which waits a full 60s before raising and
  would blow every caller's deadline at once.
- **Recycling.** Each browser is closed and relaunched after
  `SCRAPLING_SESSION_MAX_USES` navigations, and immediately after any error
  (a crashed browser stays crashed). Teardown runs as a detached task, so a
  request cancelled by the hard timeout cannot skip the cleanup.
- **An outer `asyncio.wait_for` on every render.** This matters more than it
  looks: Scrapling's `StealthConfig` silently raises any sub-60s timeout to
  60000ms whenever `solve_cloudflare` is set, so on the Cloudflare path our own
  wall is the only thing that bounds the request.
- **`--disable-dev-shm-usage`** by default. Containers get a 64MB `/dev/shm`,
  which Chromium will exhaust and crash on. Clear `SCRAPLING_EXTRA_FLAGS` only
  if you run with `--shm-size=1g`.
- **`disable_resources` on the plain path only.** Dropping fonts/images/media/
  stylesheets is a large memory win, and scripts and XHR still run so SPA state
  blobs still populate. It is *not* applied to the stealth path, because
  starving that browser of resources changes its request fingerprint — the
  opposite of what it is for. If a platform's HTML starts parsing wrong, set
  `SCRAPLING_BLOCK_RESOURCES=false` first.

Rough budget: ~250MB base per browser process plus ~150MB per busy tab. Defaults
(`MAX_PAGES=2`) fit a 1GB instance with both browsers warm. Scale by adding
machines, **not** uvicorn workers — each worker is a separate process with its
own pair of browsers.

---

## Assumptions worth re-checking

Pinned against **Scrapling 0.4.12** (source-read). The behaviour below was
additionally executed against a locally installed **0.4.2**, where the API is
identical: `AsyncStealthySession` / `AsyncDynamicSession` accept per-call
`solve_cloudflare`, `wait_selector`, `wait_selector_state`, `wait`, `timeout`,
`network_idle` and `load_dom`; `Response.status` is an `int` and
`Response.html_content` is a `TextHandler` (a `str` subclass). Confirmed by
running it: `validate_fetch({"timeout": 45000, "solve_cloudflare": True}, ...)`
comes back with `timeout=60000` — the library really does override the value you
pass, which is why the outer wall exists. If you bump the pin, re-check
`scrapling/engines/_browsers/_types.py` (`StealthFetchParams`) first.

Two things are asserted rather than measured, because they cannot be tested
without live traffic:

- The challenge-detection regex (`main.py`, `_CHALLENGE`) decides whether a
  rendered page is a Cloudflare interstitial. It mirrors the heuristic already
  in `src/lib/platforms/http.ts`. A false positive turns a good page into a
  throttle; a false negative feeds an interstitial to a parser. Check it against
  a real SPOJ response before trusting throughput numbers.
- The per-platform `wait_for` selectors live in the adapters, not here. A
  selector that has moved manifests as a hard timeout on every fetch for that
  platform — visible as `Render exceeded 26s` in the sidecar logs.
