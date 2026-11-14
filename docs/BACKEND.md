# Backend runbook

Local API and worker for the HackPrinceton demo.

## API and web together

Copy `.env.example` to `.env` and set `DATABASE_URL` (hosted Postgres with `uselibpqcompat=true&sslmode=require`). Then from the repository root:

```bash
npm run dev
```

That starts the API on port 3001 and the web app on port 5173. The Vite dev server proxies `/api` and `/health`. Identity is `IDENTITY_MODE=local`; the web app asks for a participant ID and posts it to `/api/v1/auth/local` with `org-demo`. S3/MinIO and OIDC are not required. Traces fall back to Postgres when S3 env vars are absent.

## Docker (optional)

This does not start the web app.

## One command

From the repository root, with Docker installed:

```bash
npm run dev:backend
```

That copies `.env.example` to `.env` when `.env` is missing, then runs `docker compose up --build`. Postgres, MinIO, the API (port 3001), and the worker come up together. With `IDENTITY_MODE=local` the API seeds the demo organization on startup. Set `DEMO_SEED=false` to skip that.

`NODE_ENV` stays `development` in Compose. Production refuses the in-memory object store. `IDENTITY_MODE=local` is allowed when that env is set; `COOKIE_SECURE` defaults to true in production.

## Local sign-in

`IDENTITY_MODE=local` accepts a participant ID (`subject`) of 3–32 letters, digits, or dashes and keeps `org-demo` as the org. Unknown IDs are created as participants. It is disabled when `IDENTITY_MODE=oidc`.

```bash
curl -i -X POST http://localhost:3001/api/v1/auth/local \
  -H 'content-type: application/json' \
  -d '{"subject":"participant-demo","orgId":"org-demo"}'
```

| Subject | Role | What they can do |
| --- | --- | --- |
| `admin-demo` | admin | Create participants and assignments. Cannot read measurements. |
| `reviewer-demo` | reviewer | Read the demo participant's sessions. |
| `participant-demo` | participant | Start sessions for `participant-demo`. |
| any other valid ID | participant | Created on first local sign-in; history is scoped to that ID. |

The response sets `nv_session` (HttpOnly) and `nv_csrf`. Send the CSRF value as `x-csrf-token` on POST, PUT, and DELETE.

The same rows are in `apps/api/fixtures/seed.sql` if you apply them yourself:

```bash
psql "$DATABASE_URL" -f apps/api/fixtures/seed.sql
```

## Environment

Copy `.env.example`. Compose reads `POSTGRES_*` and `S3_*`. Do not commit `.env`.

| Variable | Local demo |
| --- | --- |
| `IDENTITY_MODE` | `local` (or `oidc` with the four `OIDC_*` variables) |
| `DEMO_SEED` | omit or `true` to seed; `false` to skip |
| `COOKIE_SECURE` | `false` for http://localhost |
| `DATABASE_URL` | Inside Compose: `postgres://…@postgres:5432/…`. On the host: `@localhost:5432`. |
| `OBJECT_STORE` | `s3` with MinIO, or `memory` for tests |
| `S3_ENDPOINT` | `http://minio:9000` in Compose, `http://localhost:9000` from the host |
| `S3_BUCKET` | `neurovision-traces` (private; created on startup) |

OIDC is unchanged: `GET /api/v1/auth/login` redirects to the provider, and `GET /api/v1/auth/callback` sets the same cookies. Local sign-in returns 404 in OIDC mode.

## Trace bytes

Gaze uploads are UTF-8 JSON:

```json
{
  "version": 1,
  "trialId": "session-target",
  "streamKind": "webcam",
  "samples": [{ "elapsed": 0, "x": 200, "y": 270 }],
  "validationErrorPx": [10, 12, 8]
}
```

The worker maps `samples` with `domainSamplesToAnalysis` and summarizes them with `summarizeGaze`. Unreadable bytes stay ineligible and do not fail the job.

## Without Docker

Install dependencies, point `DATABASE_URL` at Postgres, then:

```bash
npm run start -w @neurovision/api
npm run start -w @neurovision/worker
```
