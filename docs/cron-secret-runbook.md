# `CRON_SECRET` runbook

`CRON_SECRET` authenticates every `/api/public/**` endpoint — the refresh cron,
the job pump, the chunk runner and the demo seeder. It must be the **same value
in three places**, and a mismatch in any one of them shows up as a `401` on the
GitHub Actions pump.

There is deliberately **no `x-vercel-cron` fallback**. That header is
client-suppliable — Vercel sets it on its own cron invocations but does not strip
one sent by a caller — so trusting it left every endpoint under `/api/public`,
including the one that *writes* demo data to production, open to anyone who sent
the header. The secret is the only accepted credential.

## The three places

| Where | What it authenticates | How to set |
|---|---|---|
| **Vercel** project env | The deployed app. Also what Vercel Cron sends. | Settings → Environment Variables → `CRON_SECRET`, **Production** checked |
| **GitHub** repo secret | The 10-minute pump workflow | Settings → Secrets and variables → Actions → Secrets → `CRON_SECRET` |
| Local `.env` | `scripts/*.mjs` and local testing | edit `.env` |

The Vercel one is load-bearing twice over: when a project has an env var named
exactly `CRON_SECRET`, Vercel automatically sends
`Authorization: Bearer <value>` on its own cron invocations. That is what keeps
the `vercel.json` cron (`/api/public/cron/refresh`, daily 18:30) working. Rename
the variable and that cron silently starts 401-ing.

Also set the `DEPLOY_URL` **repository variable** (Settings → Secrets and
variables → Actions → *Variables* tab) to the deployment origin, e.g.
`https://almaanac.vercel.app`, with no trailing slash. `pump.yml` falls back to a
hardcoded default, and a wrong default means every pump POSTs to the wrong host —
which fails no matter how correct the secret is.

## Rotation

Order matters. Vercel first, then deploy, then GitHub — if you do GitHub first,
the pump fires against a deployment still holding the old value and you get a
confusing 401 in the gap.

1. **Generate** (never paste the result into a chat, issue, or commit):
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
   Produces a 43-character base64url string.

2. **Vercel** → Environment Variables → edit the existing `CRON_SECRET`
   (don't add a second one) → Production ✓ → Save.

3. **Redeploy.** Env vars are applied at build time; an existing deployment will
   not pick up the new value.
   ```powershell
   npx vercel --prod
   ```

4. **Verify** before touching GitHub:
   ```powershell
   curl.exe -i -X POST https://almaanac.vercel.app/api/public/jobs/pump -H "Authorization: Bearer PASTE_REAL_VALUE" --max-time 90
   ```

5. **GitHub** → Actions secrets → `CRON_SECRET` → same value.

6. **Local `.env`** → same value.

7. Trigger Actions → *Refresh Job Pump* → Run workflow, and confirm it is green.

## Reading the response

`cronGuard()` in `src/integrations/supabase/cron-auth.ts` distinguishes the two
failure modes. They used to both return a bare 401, which made a dead cron
impossible to diagnose — you could not tell "not set in Vercel" from "does not
match GitHub".

| Status | Body | Meaning |
|---|---|---|
| `200` | job payload | Working. |
| `500` | `CRON_SECRET is not configured on this deployment` | The env var is missing from the deployment, wasn't applied to Production, or you haven't redeployed since adding it. |
| `401` | `Unauthorized` | The var exists but the value you sent doesn't match it. |
| `504` / `408` | — | Chunk outlived the platform limit. Not a failure — the job keeps its cursor and the next pump resumes. `pump.yml` treats these as a warning. |

Returning 500 for the unconfigured case is not a credential oracle: the answer
does not depend on what the caller supplied.

Use `curl.exe -i` (not PowerShell's `curl`, which is an alias for
`Invoke-WebRequest` and rejects `-H "string"`), and read the **body** — that is
where the diagnosis lives.

## Comparing values without exposing them

To check whether two locations hold the same secret, compare fingerprints rather
than values. PowerShell and Node produce identical output for the same input, so
results are comparable across machines:

```powershell
$s = Read-Host "Paste secret"; $h = [System.Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($s)); "length: $($s.Length)  sha256[0:12]: $((([BitConverter]::ToString($h)) -replace '-','').ToLower().Substring(0,12))"
```

Paste the actual secret, not a fingerprint. Matching values give identical length
*and* hash prefix.

## If a secret is exposed

Pasting a secret into a chat, screenshot, issue, or log burns it. Treat it as
compromised and rotate immediately using the steps above. Until you do, anyone
holding it can enqueue platform-wide scrape jobs, run chunks, and write demo data
into production.
