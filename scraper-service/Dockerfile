# Scrapling sidecar. ~1.3GB built — almost all of it Chromium, which is exactly
# why this cannot be a serverless function.
FROM python:3.12-slim-trixie

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # Pin the browser download location so it is (a) baked into an image layer
    # rather than re-fetched per container, and (b) readable by the non-root
    # user we drop to at the end. The default (~/.cache/ms-playwright) lands in
    # root's home and is unreadable after USER changes.
    PLAYWRIGHT_BROWSERS_PATH=/opt/browsers \
    HOME=/home/app

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

# Browsers and their system libraries are installed AT BUILD TIME, never at
# runtime. Doing this on first request would add ~60s and ~400MB of download to
# a cold start, inside a request the caller has already put a 30s deadline on.
#
#   `scrapling install`  -> `playwright install chromium`
#                        +  `playwright install-deps chromium`  (needs apt)
#                        +  TLD dataset refresh
#   `patchright install` -> the separate stealth-patched Chromium build that
#                           AsyncStealthySession (the solve_cloudflare path)
#                           launches. `scrapling install` does NOT fetch it, so
#                           without this line every Cloudflare request fails at
#                           runtime with a missing-executable error.
RUN apt-get update \
    && scrapling install \
    && python -m patchright install chromium \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

COPY main.py ./

# Chromium refuses to start as root without --no-sandbox, and running a browser
# that executes untrusted JS as root with the sandbox off is the worst of both
# options. Drop privileges instead and keep the sandbox.
RUN useradd --create-home --home-dir /home/app --shell /usr/sbin/nologin app \
    && chown -R app:app /home/app /app
USER app

ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8000')+'/health',timeout=4)"

# --workers 1 is load-bearing, not a default. Each uvicorn worker is its own
# process with its own pair of browsers; two workers silently doubles the memory
# ceiling while halving the effective session reuse. Scale with more machines,
# not more workers.
#
# --timeout-keep-alive 75 sits above the longest render (55s Cloudflare wall) so
# the connection is not torn down underneath a request that is still working.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --timeout-keep-alive 75"]
