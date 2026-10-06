# KDone — Deployment

Web app → **Vercel**. Worker → **Render Background Worker**. Database → **Neon**. Queue → **Upstash Redis**.

---

## ⚠️ The one mistake that fails silently

**`REDIS_URL` must be byte-identical in Vercel and Render.**

If they differ, the web app enqueues jobs to Redis A while the worker consumes
from Redis B. No error is raised anywhere. Jobs simply never run, books sit at
`QUEUED` forever, and the only symptom is a silent stall.

After configuring both services, verify: enqueue a job from Vercel, then confirm
in Upstash that the queue length went up **and** that Render's worker log shows
it processing the job.

---

## 1. Neon (database)

1. Create a project and region.
2. **Copy the pooled connection string.** Use the **direct** (non-`-pooler`)
   hostname if you can; the pooled endpoint works too — prepared statements are
   auto-disabled for `*-pooler` hosts.
3. Strip `channel_binding=require`. `postgres-js` cannot negotiate channel
   binding and the connection is torn down with `CONNECTION_ENDED`.
4. **Do not enable Prisma/connection pooling in the Neon dashboard** on top of
   the pooled endpoint — the app already manages its own pool (`max: 5`).
5. Apply migrations from a local checkout:
   ```bash
   DATABASE_URL='<your neon url>' pnpm --filter @kdone/db migrate
   ```

**Settings to enter:** none in the Neon UI beyond the connection string. Keep
the default `sslmode=require`.

---

## 2. Upstash Redis (queue)

1. Create a database.
2. Copy the **TLS** (`rediss://`) connection string, including the password.
3. Upstash requires TLS for managed endpoints.

**Settings to enter:** the single `REDIS_URL` value. Copy it verbatim into both
Vercel and Render.

---

## 3. Render — Background Worker (Starter, $7/mo)

1. **New → Background Worker** (not a Web Service).
2. Connect the GitHub repo, branch `main`.
3. **Root Directory:** leave **blank** (monorepo). If Render requires one, use
   `.` and set the start command manually.
4. **Runtime:** Node.
5. **Start Command:**
   ```
   pnpm install --frozen-lockfile && pnpm --filter @kdone/db build && pnpm --filter worker start
   ```
6. **Health check path:** leave blank (not a web service).
7. Add environment variables (below).

> The worker runs TypeScript via `tsx`, so it must be able to install dev
> dependencies. If you switch to a compiled build, change the command to
> `pnpm --filter worker build && node apps/worker/dist/main.js`.

---

## 4. Vercel (web)

1. **Add New → Project** → import the repo, branch `main`.
2. **Framework Preset:** Next.js (auto-detected from `vercel.json`).
3. **Root Directory:** leave **blank** (vercel.json sets
   `buildCommand: turbo build --filter=web` and
   `outputDirectory: apps/web/.next` for the monorepo).
4. **Install Command:** `pnpm install --frozen-lockfile`
5. **Build Command:** `turbo build --filter=web`
6. **Output Directory:** `apps/web/.next`
7. Add environment variables (below).
8. Deploy, then set `AUTH_URL` and `NEXT_PUBLIC_APP_URL` to the assigned
   `https://*.vercel.app` domain and redeploy.

> Vercel must be able to run `turbo`. `vercel.json` does not set
> `rootDirectory`, which is correct for a monorepo.

---

## Environment variables by service

| Variable | Vercel (web) | Render (worker) | Notes |
|---|---|---|---|
| `DATABASE_URL` | ✅ | ✅ | Same Neon URL. Strip `channel_binding`. |
| `AUTH_SECRET` | ✅ | — | Secret. `openssl rand -base64 32`. |
| `AUTH_URL` | ✅ | — | `https://<app>.vercel.app` |
| `AUTH_TRUST_HOST` | ✅ | — | `true` behind a proxy |
| `NEXT_PUBLIC_APP_URL` | ✅ | — | `https://<app>.vercel.app` |
| `REDIS_URL` | ✅ | ✅ | **Must be identical in both.** |
| `QUEUE_DRIVER` | `bullmq` | `bullmq` | Unset ⇒ in-process only. |
| `NODE_ENV` | platform | platform | `production` |
| `AUTH_DEV_LOGIN` | omit | — | Must be absent in production. |
| `S3_*` | optional | optional | **Unused today** — see below. |

---

## R2 / MinIO / S3 keys are optional until S3 exists

There is **no S3 StorageProvider implementation**. The only implementation is
`MockStorageProvider`, which keeps bytes in process memory — on Vercel that
means **covers and EPUBs are lost between invocations**.

Do not configure `S3_*` yet. Implementing a real S3-compatible provider is the
**first post-deploy task**. Until then, treat asset persistence as broken in
hosted environments.

---

## Post-deploy verification

```bash
# 1. Health: the app serves
curl -I https://<app>.vercel.app/login

# 2. Registration works end to end (proves DB + auth)
#    POST /api/register with { email, password (>=10 chars) }

# 3. Sign in through the browser, reach /dashboard

# 4. Trigger a job and confirm Render picks it up
#    POST /api/books/:id/research  →  watch the Render worker log
```

If (4) shows jobs enqueued but the worker is idle, you have the Redis mismatch.
