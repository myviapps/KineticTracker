"""
Scrapling sidecar — a browser that renders JS and gets past Cloudflare.

WHAT THIS IS NOT
================
This is not a crawler. The app (see `src/lib/platform-worker.server.ts` and the
`platforms` table) already owns scheduling, per-platform throttling, the circuit
breaker, retry counting and cursors. It needs exactly one capability it cannot
have inside a serverless function: a real browser. So this service does one
thing — hand back the HTML a browser would have seen — and nothing else. No
extraction, no schemas, no storage. All parsing stays in TypeScript.

THE CONTRACT (mirrors src/lib/platforms/render.ts, field for field)
===================================================================
  POST /fetch
    Authorization: Bearer <SCRAPLING_TOKEN>     (only when the token is set)
    { "url": str, "wait_for": str|null, "solve_cloudflare": bool, "settle_ms": int }

  200 { "html": "<...>", "status": 200 }   -> the client returns parsed.html
  404 { "status": 404 }                    -> the client throws `not_found`
                                              (it checks res.status === 404 AND
                                              parsed.status === 404; we satisfy
                                              both so neither ordering matters)
  200 { "error": "...", "status": <n> }    -> the client throws `throttle`
  5xx <anything>                           -> the client throws `throttle`
  4xx (other) <anything>                   -> the client throws `fail`

  GET /health -> 200, never launches a browser.

Note the deliberate asymmetry: "we reached the site and still could not read it"
is a 200 with an `error` key, NOT an HTTP error. render.ts turns that into a
throttle so the worker backs off the *platform*, instead of blaming the
student's handle. Getting this wrong would mark good handles as invalid.

BROWSER LIFECYCLE / MEMORY  (the part that decides whether this box survives)
============================================================================
A Chromium per request would exhaust a 512MB box after two concurrent fetches.
Three things prevent that:

  1. Long-lived sessions, not per-request fetchers. `StealthyFetcher.fetch()`
     launches and tears down a browser on every call. Instead we hold at most
     TWO browser processes for the lifetime of the service and reuse them:
       - AsyncDynamicSession  — plain Chromium, for the JS-rendered platforms
                                (hackerearth, interviewbit, code360)
       - AsyncStealthySession — patchright stealth + the Cloudflare solver,
                                for spoj
     Both are started LAZILY. A deployment that never sees solve_cloudflare=true
     never pays for the second browser. Per-request options still work because
     Scrapling's `session.fetch(url, **kwargs)` accepts per-call overrides
     (StealthFetchParams / PlaywrightFetchParams) — including solve_cloudflare,
     wait_selector, wait and timeout.

  2. A tab pool, not a process pool. `max_pages` caps concurrent tabs inside the
     one process. A global semaphore of the same size gates entry, so we never
     queue inside Scrapling's pool (which waits 60s then raises).

  3. Recycling. Chromium leaks over hundreds of navigations. After
     SESSION_MAX_USES requests — or immediately after any error, since a crashed
     browser stays crashed — the session is closed and the next request starts a
     fresh one. Recycling only happens when the tab count is back to zero, and
     runs as a detached task so a cancelled request cannot skip the cleanup.

Run with ONE uvicorn worker. Each worker is a separate process and would get its
own pair of browsers, silently multiplying the memory ceiling.
"""

from __future__ import annotations

import asyncio
import hmac
import logging
import os
import re
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional, Set

from fastapi import FastAPI, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from scrapling.fetchers import AsyncDynamicSession, AsyncStealthySession

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("scraper-service")


# ─── Configuration ────────────────────────────────────────────────────────────


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "") or default)
    except ValueError:
        log.warning("%s is not an integer; using %s", name, default)
        return default


def _bool_env(name: str, default: bool) -> bool:
    raw = (os.getenv(name, "") or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


TOKEN = os.getenv("SCRAPLING_TOKEN", "").strip()

# Tabs per browser. Two is the sweet spot on a 1GB box; each extra tab on a
# heavy SPA costs roughly 80-150MB of resident memory.
MAX_PAGES = max(1, _int_env("SCRAPLING_MAX_PAGES", 2))
# Never admit more concurrent renders than we have tabs — otherwise requests
# block inside Scrapling's page pool, which waits a full 60s before raising.
MAX_CONCURRENCY = max(1, _int_env("SCRAPLING_MAX_CONCURRENCY", MAX_PAGES))
# Navigations before a browser is retired. Low enough to bound leaks, high
# enough that the ~2s cold start is amortised away.
SESSION_MAX_USES = max(1, _int_env("SCRAPLING_SESSION_MAX_USES", 60))

# Timeout passed INTO Scrapling ("used in all operations and waits through the
# page"). Kept under the client's own AbortSignal so we answer rather than get
# cut off — render.ts aborts at 30s normally and 60s for a Cloudflare solve.
NAV_TIMEOUT_MS = _int_env("SCRAPLING_TIMEOUT_MS", 20_000)
CF_NAV_TIMEOUT_MS = _int_env("SCRAPLING_CF_TIMEOUT_MS", 45_000)

# The outer wall. This one actually matters: Scrapling's StealthConfig RAISES a
# sub-60s timeout to 60_000 whenever solve_cloudflare is set, so on the
# Cloudflare path NAV_TIMEOUT_MS is silently ignored and this is the only thing
# standing between us and a hung request. Both values sit below the client's
# abort so it sees a classified answer instead of a dead socket.
HARD_TIMEOUT_MS = _int_env("SCRAPLING_HARD_TIMEOUT_MS", 26_000)
CF_HARD_TIMEOUT_MS = _int_env("SCRAPLING_CF_HARD_TIMEOUT_MS", 55_000)

# The absolute bound on a per-request `ceiling_ms` (see FetchRequest). Sits below
# the worker's 50s chunk with room for the client's own 4s reserve, so even a
# platform that asks for the maximum still returns a classified answer rather
# than having the socket closed under it.
MAX_CEILING_MS = _int_env("SCRAPLING_MAX_CEILING_MS", 42_000)

MAX_SETTLE_MS = _int_env("SCRAPLING_MAX_SETTLE_MS", 10_000)

HEADLESS = _bool_env("SCRAPLING_HEADLESS", True)
# Drops font/image/media/stylesheet/websocket requests. Scripts and XHR still
# run, so SPA state blobs still populate. Big memory and bandwidth win, but it
# is the FIRST knob to turn off if a platform's HTML starts coming back wrong.
# Only applied to the plain-Chromium path: starving the stealth browser of
# resources changes its request fingerprint, which is the opposite of the point.
BLOCK_RESOURCES = _bool_env("SCRAPLING_BLOCK_RESOURCES", True)

# ── A tuning lever that was investigated and deliberately NOT taken ──────────
# Scrapling waits for the `load` event unconditionally — see
# engines/_browsers/_base.py::_wait_for_page_stability, where
# `page.wait_for_load_state(state="load")` runs BEFORE the load_dom and
# network_idle options are consulted. There is no way to ask it for
# domcontentloaded only, so `load` is the floor on every render we do, and
# `load` does not fire until the last third-party tracker has finished.
#
# Scrapling's session does accept a `blocked_domains` set, which would cut that.
# `disable_resources` cannot substitute: EXTRA_RESOURCES is
# {font, image, media, beacon} — resource TYPES — while analytics arrives as
# `script` and `xhr`, the very types a JS-rendered page needs.
#
# It is not enabled because it was never validly measured. The Code360 profile
# used as the test subject was deleted by its owner midway through the
# experiment, so every "faster" reading afterwards was the ~65KB 404 shell
# rather than the ~280KB profile — a comparison between two different pages.
# Blocking domains on a page that needs them fails CLOSED (missing data that
# parses as a bad handle), so it stays off until someone re-measures it against
# a profile that stays put.

# /dev/shm is 64MB in a default container and Chromium will crash on a heavy
# page without this. Set SCRAPLING_EXTRA_FLAGS="" if you run with --shm-size.
EXTRA_FLAGS = [f for f in os.getenv("SCRAPLING_EXTRA_FLAGS", "--disable-dev-shm-usage").split() if f]

# Launch the plain browser at boot instead of on the first request. See the
# lifespan handler for the measurement that motivates it. Set false only if
# memory at idle matters more than the first request succeeding.
WARM_ON_START = _bool_env("SCRAPLING_WARM_ON_START", True)

# Bodies above this are certainly real pages, so skip the challenge scan.
_CHALLENGE_SCAN_LIMIT = 200_000
_CHALLENGE = re.compile(
    r"<title>\s*just a moment"
    r"|cf-browser-verification"
    r"|challenge-platform"
    r"|__cf_chl"
    r"|cf_chl_opt"
    r"|enable javascript and cookies to continue"
    r"|checking your browser before accessing",
    re.IGNORECASE,
)


# ─── Background task registry ─────────────────────────────────────────────────

_BACKGROUND: Set[asyncio.Task] = set()


def _spawn(coro) -> None:
    """Fire-and-forget, with a strong reference so the loop cannot GC it mid-flight."""
    task = asyncio.ensure_future(coro)
    _BACKGROUND.add(task)
    task.add_done_callback(_BACKGROUND.discard)


# ─── Browser pool ─────────────────────────────────────────────────────────────


class BrowserPool:
    """One lazily-started, recycled browser session with a bounded tab pool."""

    def __init__(self, name: str, factory, max_uses: int) -> None:
        self.name = name
        self._factory = factory
        self._max_uses = max_uses
        self._session: Any = None
        self._lock = asyncio.Lock()
        self._uses = 0
        self._inflight = 0
        self._doomed = False
        self._starts = 0

    async def ensure_ready(self) -> Any:
        """Start the browser if it is not running. Raises if the launch fails.

        The lock is held across the launch on purpose: a few seconds of queueing
        is much cheaper than two coroutines each starting a Chromium.
        """
        async with self._lock:
            if self._session is None:
                log.info("starting %s browser (start #%d)", self.name, self._starts + 1)
                session = self._factory()
                await session.__aenter__()
                self._session = session
                self._uses = 0
                self._doomed = False
                self._starts += 1
            return self._session

    @asynccontextmanager
    async def lease(self):
        session = await self.ensure_ready()
        self._inflight += 1
        self._uses += 1
        failed = False
        try:
            yield session
        except BaseException:
            # Includes CancelledError from the hard timeout. A browser that
            # timed out mid-navigation may be holding a wedged tab; retiring it
            # is cheaper than debugging it.
            failed = True
            raise
        finally:
            self._inflight -= 1
            if failed:
                self._doomed = True
            if self._inflight == 0 and (self._doomed or self._uses >= self._max_uses):
                # Detached, never awaited here: this `finally` may be unwinding a
                # cancelled task, where any `await` re-raises CancelledError
                # immediately and would leak the browser process.
                _spawn(self._recycle())

    async def _recycle(self) -> None:
        async with self._lock:
            if self._inflight or self._session is None:
                return  # someone grabbed it first; it will be retired later
            session, self._session = self._session, None
            reason = "error" if self._doomed else f"{self._uses} uses"
            self._doomed = False
            self._uses = 0
        log.info("recycling %s browser (%s)", self.name, reason)
        try:
            # Outside the lock so a new request can start a fresh browser while
            # this one drains. Worst case is a brief two-process overlap.
            await session.__aexit__(None, None, None)
        except Exception as exc:  # pragma: no cover - teardown is best-effort
            log.warning("error closing %s browser: %r", self.name, exc)

    async def shutdown(self) -> None:
        async with self._lock:
            session, self._session = self._session, None
        if session is not None:
            try:
                await session.__aexit__(None, None, None)
            except Exception as exc:  # pragma: no cover
                log.warning("error closing %s browser on shutdown: %r", self.name, exc)

    def stats(self) -> Dict[str, Any]:
        return {
            "running": self._session is not None,
            "inflight": self._inflight,
            "uses": self._uses,
            "max_uses": self._max_uses,
            "starts": self._starts,
        }


def _dynamic_session():
    """Plain Chromium. Enough for hackerearth / interviewbit / code360."""
    return AsyncDynamicSession(
        max_pages=MAX_PAGES,
        headless=HEADLESS,
        timeout=NAV_TIMEOUT_MS,
        # No block_ads: it is not a Scrapling option. Both session classes take
        # **kwargs and validate internally, so passing it raised at browser
        # startup rather than being ignored — every fetch would have failed on
        # the first launch. `disable_resources` is the real knob and is already
        # doing that job on this path.
        disable_resources=BLOCK_RESOURCES,
        extra_flags=EXTRA_FLAGS,
    )


def _stealth_session():
    """Patchright stealth build. Only this one can solve a Cloudflare interstitial."""
    return AsyncStealthySession(
        max_pages=MAX_PAGES,
        headless=HEADLESS,
        timeout=CF_NAV_TIMEOUT_MS,
        # No disable_resources here — see BLOCK_RESOURCES above.
        # No block_ads either; it is not a Scrapling option at all.
        extra_flags=EXTRA_FLAGS,
    )


DYNAMIC = BrowserPool("dynamic", _dynamic_session, SESSION_MAX_USES)
STEALTH = BrowserPool("stealth", _stealth_session, SESSION_MAX_USES)
GATE = asyncio.Semaphore(MAX_CONCURRENCY)


# ─── App ──────────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(_: FastAPI):
    log.info(
        "scraper-service up (max_pages=%d concurrency=%d recycle_after=%d auth=%s)",
        MAX_PAGES,
        MAX_CONCURRENCY,
        SESSION_MAX_USES,
        "on" if TOKEN else "OFF",
    )
    if not TOKEN:
        log.warning("SCRAPLING_TOKEN is unset — every caller is accepted. Do not do this in production.")

    """
    Warm the plain browser before serving.

    MEASURED: a warm fetch of a JS-heavy profile takes 12-15s, but the FIRST one
    also pays for the Chromium launch and blew the 26s hard timeout outright. So
    the opening fetch of every deployment failed — and because a session is
    recycled after SESSION_MAX_USES navigations, so did every 60th fetch after
    that, forever, at no fixed time anyone could correlate.

    Raising the hard timeout instead would be the wrong fix: render.ts aborts at
    30s on this path, so there is no headroom to give, and the worker's whole
    chunk budget is 50s. Paying the launch once at boot is what removes the
    cliff rather than moving it.

    STEALTH stays lazy on purpose. It is the memory-expensive one, and a
    deployment that never fetches SPOJ should never pay for it. Its 55s budget
    also has room to absorb a cold start, which this path does not.
    """
    if WARM_ON_START:
        try:
            await DYNAMIC.ensure_ready()
            log.info("dynamic browser pre-warmed")
        except Exception as exc:  # noqa: BLE001 - startup must not be fatal
            # A failure here is not worth refusing to boot over: the pool will
            # retry lazily on the first request, which is the old behaviour.
            log.warning("pre-warm failed (%s); falling back to lazy start", exc)

    yield
    await asyncio.gather(DYNAMIC.shutdown(), STEALTH.shutdown(), return_exceptions=True)


app = FastAPI(title="scraper-service", version="1.0.0", lifespan=lifespan)


class FetchRequest(BaseModel):
    """Exactly the body render.ts sends. Defaults mirror its `?? null / ?? false / ?? 0`."""

    url: str
    wait_for: Optional[str] = None
    solve_cloudflare: bool = False
    # Not constrained with ge=0: a stray negative should degrade to "no settle",
    # not 422 the whole fetch. It is clamped where it is used.
    settle_ms: int = 0
    # The caller's own remaining budget, in ms.
    #
    # The worker gives each chunk 50s, which is LESS than CF_HARD_TIMEOUT_MS.
    # Without this the client aborts at its deadline while we keep rendering,
    # holding a browser for a response that will never be read — and the accounts
    # queued behind it lose their turn as well.
    #
    # Only ever shortens: clamped against the configured ceiling below, so a
    # caller cannot ask us to hold a browser longer than the operator allows.
    timeout_ms: Optional[int] = None
    # The one field that can RAISE the default ceiling, for platforms that are
    # simply slower than the norm rather than broken.
    #
    # MEASURED on 2026-08-05: naukri.com/code360 renders its profile SPA in
    # ~29.5s on the plain browser. Against HARD_TIMEOUT_MS (26s) that is a
    # guaranteed 504 on every single fetch — the platform could never work, and
    # the failure looked like a dead site rather than a budget that was 4s short.
    #
    # Raising HARD_TIMEOUT_MS globally instead would make every OTHER rendered
    # platform's failure path slower for one platform's benefit, so this is opt-in
    # per request. Still bounded twice: by MAX_CEILING_MS below, and by
    # timeout_ms, so the caller's real deadline always wins.
    ceiling_ms: Optional[int] = None


def _blocked(message: str, status: int) -> JSONResponse:
    """Reachable but unreadable. HTTP 200 on purpose -> client classifies `throttle`."""
    return JSONResponse({"error": message, "status": status}, status_code=200)


def _not_found() -> JSONResponse:
    """HTTP 404 *and* status:404 in the body — render.ts checks both."""
    return JSONResponse({"status": 404}, status_code=404)


def _authorized(header: Optional[str]) -> bool:
    if not TOKEN:
        return True
    if not header:
        return False
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer":
        return False
    return hmac.compare_digest(value.strip(), TOKEN)


@app.get("/health")
async def health() -> Dict[str, Any]:
    """Cheap enough for a 5s platform healthcheck — deliberately starts nothing."""
    return {
        "status": "ok",
        "auth": bool(TOKEN),
        "max_pages": MAX_PAGES,
        "max_concurrency": MAX_CONCURRENCY,
        "browsers": {"dynamic": DYNAMIC.stats(), "stealth": STEALTH.stats()},
    }


@app.post("/fetch")
async def fetch(req: FetchRequest, authorization: Optional[str] = Header(default=None)):
    if not _authorized(authorization):
        # 401 is a non-ok, non-404, sub-500 status, so render.ts raises `fail`.
        # Correct: a bad token is our misconfiguration, not a site throttling us,
        # and it should not be retried with backoff.
        return JSONResponse({"error": "unauthorized", "status": 401}, status_code=401)

    url = req.url.strip()
    if not url.lower().startswith(("http://", "https://")):
        return JSONResponse({"error": "url must be http(s)", "status": 400}, status_code=400)

    cf = bool(req.solve_cloudflare)
    pool = STEALTH if cf else DYNAMIC

    # The configured ceiling is the operator's limit; the caller's remaining
    # budget can only bring it down. min() rather than a choice, so neither side
    # can extend the other's bound.
    ceiling_ms = CF_HARD_TIMEOUT_MS if cf else HARD_TIMEOUT_MS
    if not cf and req.ceiling_ms and req.ceiling_ms > 0:
        # Raise, never lower — a caller shortening its own budget does that with
        # timeout_ms, which is applied after this and therefore still wins.
        ceiling_ms = min(max(ceiling_ms, int(req.ceiling_ms)), MAX_CEILING_MS)
    if req.timeout_ms and req.timeout_ms > 0:
        ceiling_ms = min(ceiling_ms, int(req.timeout_ms))
    # A floor, so a caller with almost no budget left gets a real attempt rather
    # than a browser launched purely to be cancelled.
    hard_timeout = max(5.0, ceiling_ms / 1000.0)

    kwargs: Dict[str, Any] = {
        "timeout": CF_NAV_TIMEOUT_MS if cf else NAV_TIMEOUT_MS,
        "load_dom": True,
        # network_idle is left off: these profile pages poll analytics forever
        # and would never go idle. wait_for / settle_ms are the readiness signal.
        "network_idle": False,
    }
    if cf:
        kwargs["solve_cloudflare"] = True
    """
    A wait_selector that never matches must NOT cost us the page.

    MEASURED on 2026-08-05 against https://www.hackerearth.com/@<fake>/, which
    HackerEarth answers with a genuine HTTP 404:

        the selector never attaches (a 404 shell has no stat cards)
          -> the wait ran to the 26s wall
          -> _blocked(504) -> the client raises `throttle`
          -> the worker treats it as retryable and comes back forever

    The page's real 404 status is read at the bottom of this function and would
    have settled it instantly — we simply never got there. So every mistyped
    handle burned 26 seconds of a 50 second chunk and was never once recorded as
    a bad handle.

    The selector is a READINESS HINT, not a precondition. When it does not land,
    fall back to a plain render and let the status checks and the adapter's own
    parseAssert decide — those distinguish "no such user" from "layout moved",
    which a timeout cannot.

    Budget for the fallback is reserved up front rather than measured after the
    fact, so the first attempt cannot consume the whole wall and leave nothing.
    Real profiles attach in ~8s against an 18s first slice, so this costs the
    common path nothing.
    """
    retry_budget = 0.0
    if req.wait_for:
        kwargs["wait_selector"] = req.wait_for
        # "attached" (Scrapling's default), not "visible": the adapters parse the
        # DOM, and requiring paint would fail on off-screen or collapsed nodes.
        kwargs["wait_selector_state"] = "attached"
        retry_budget = min(8.0, hard_timeout / 3.0)
        # Hand the shortened deadline to Scrapling as well, so IT raises and
        # unwinds its own page. Cancelling mid-fetch from the outside returns the
        # session to the pool in an unknown state, and the pool is reused 60x.
        kwargs["timeout"] = min(kwargs["timeout"], int((hard_timeout - retry_budget) * 1000))
    settle = min(int(req.settle_ms or 0), MAX_SETTLE_MS)
    if settle > 0:
        # Scrapling's `wait` is "time in ms to wait after everything finishes,
        # before closing the page" — exactly what settle_ms means to the client.
        kwargs["wait"] = settle

    async with GATE:
        # Started before the lease so a launch failure is distinguishable from a
        # page failure: 503 (our browser is broken) vs 200+error (the site
        # blocked us). Both end up as `throttle` client-side, but only one of
        # them means "go look at the sidecar".
        try:
            await pool.ensure_ready()
        except Exception as exc:
            log.exception("failed to start %s browser", pool.name)
            return JSONResponse(
                {"error": f"browser unavailable: {exc!r}", "status": 503}, status_code=503
            )

        first_slice = hard_timeout - retry_budget
        page = None
        try:
            page = await asyncio.wait_for(_render(pool, url, kwargs), timeout=first_slice)
        except asyncio.TimeoutError as exc:
            first_error: Exception = exc
            log.warning("hard timeout after %.1fs: %s", first_slice, url)
        except Exception as exc:
            # Navigation errors, wait_selector timeouts, DNS failures, protocol
            # errors. Only the selector case is worth a second look; the rest are
            # cheap to re-attempt and will fail the same way twice.
            first_error = exc
            log.warning("render failed for %s: %r", url, exc)
        else:
            first_error = None  # type: ignore[assignment]

        if page is None and retry_budget > 0:
            # Drop the selector and take whatever the page is. Chiefly this turns
            # a 404 shell into a real 404 answer instead of a 26s throttle.
            log.info("retrying without wait_selector: %s", url)
            retry_kwargs = {k: v for k, v in kwargs.items() if k != "wait_selector"}
            retry_kwargs.pop("wait_selector_state", None)
            # `wait` (settle_ms) goes too. A page that did not produce its
            # readiness selector in the first slice will not produce it in the
            # reserve, and paying the settle here is what would make the retry
            # time out as well — which lands us back on the 504 we came to avoid.
            retry_kwargs.pop("wait", None)
            retry_kwargs["timeout"] = int(retry_budget * 1000)
            try:
                page = await asyncio.wait_for(
                    _render(pool, url, retry_kwargs), timeout=retry_budget
                )
            except Exception as exc:
                log.warning("selector-free retry also failed for %s: %r", url, exc)

        if page is None:
            err = first_error
            if isinstance(err, asyncio.TimeoutError):
                return _blocked(f"Render exceeded {hard_timeout:.1f}s", 504)
            return _blocked(f"Render failed: {type(err).__name__}: {err}", 502)

    status = int(getattr(page, "status", 0) or 0)
    html = _html_of(page)

    if status == 404:
        return _not_found()
    if status and not 200 <= status < 400:
        return _blocked(f"Upstream returned HTTP {status}", status)
    if not html.strip():
        return _blocked("Renderer returned an empty document", status or 502)
    if len(html) < _CHALLENGE_SCAN_LIMIT and _CHALLENGE.search(html):
        # Got through the network, not through the wall. For SPOJ this means the
        # solver ran and the interstitial is still up.
        return _blocked("Bot challenge still present after render", status or 403)

    return {"html": html, "status": status or 200}


async def _render(pool: BrowserPool, url: str, kwargs: Dict[str, Any]):
    async with pool.lease() as session:
        return await session.fetch(url, **kwargs)


def _html_of(page: Any) -> str:
    """`html_content` is a TextHandler (a str subclass); normalise to plain str."""
    try:
        content = page.html_content
        if content:
            return str(content)
    except Exception:  # pragma: no cover - fall through to the raw body
        pass
    body = getattr(page, "body", None)
    if isinstance(body, (bytes, bytearray)):
        return body.decode("utf-8", errors="replace")
    return str(body or "")
