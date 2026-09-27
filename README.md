# BOS (v3)

One organization's email operations: inbound email → classified work →
reviewed, approved replies and quotes. Monorepo layout:

```
apps/backend   BOS API + application core (NestJS on Node.js)
apps/web       Operator UI + public quote pages (Next.js App Router)
config/        Tenant configuration JSON (validated at boot, fails closed)
docs/          Product, architecture, and plan documents
scripts/       Repo-level tooling (architecture dependency check, dev runner)
```

## Prerequisites

- [Bun](https://bun.com) 1.3+ — package manager and script runner
- Node.js 24 — backend and web runtime (never run Nest on the Bun runtime)
- Docker — local PostgreSQL only

## Install

```sh
bun install
cp .env.example .env   # fill in secrets locally; never commit them
```

## Local PostgreSQL

```sh
docker compose up -d       # PostgreSQL 17 on 127.0.0.1:5432, db/user/pass: bos
bun run db:migrate         # applies migrations for DB_DIALECT (postgres default)
```

## Owner login

On boot, when no operator credentials exist, the backend seeds one owner
from `BOS_OWNER_EMAIL` / `BOS_OWNER_PASSWORD` (see `.env.example`). Sign in
at the web app's `/login`; the session cookie lasts 7 days.

## Inbound email

`POST /inbound/emails` accepts the normalized `InboundEmail` DTO behind
`Authorization: Bearer <BOS_INGRESS_KEY>` (constant-time compare). A new
message returns **201** `{ messageId, conversationId, duplicate: false,
processing }` — `processing` is the post-commit status (`ready`,
`needs_human`, or `failed`); a processing failure still returns 201. A
replay of the same `(mailboxId, sourceMessageId)` returns **200** with the
original ids and `duplicate: true` and does not restart processing. The
body's `mailboxId` must equal the configured mailbox id (else 422).
Threads form only via `inReplyTo` / `references` against stored RFC
Message-IDs in the same mailbox.

## Processing

Every inbound message is processed after its receipt commits: the
classifier assigns a lane, and one `processing_revisions` row records
each attempt (`pending → processing → ready | needs_human | failed`).
Complaints are urgent and always `needs_human`; low confidence and the
`other` lane go to a human; noise parks as `ready` with no draft. The
owner inbox filters are `GET /inbox?filter=all|needs_human|complaints`
(invalid filter → 422), and threads show lane, status, and summary.
`POST /messages/:messageId/retry-processing` (session required) appends a
new revision and is a no-op while one is already `processing`.

`AI_ADAPTER=fake` (the default, also used when unset) is deterministic and
makes no network call. `AI_ADAPTER=vercel` uses the Vercel AI SDK. An
OpenAI key (`OPENAI_API_KEY`, or an `sk-` value in `AI_GATEWAY_API_KEY`)
calls OpenAI directly. Any other key uses the Vercel AI Gateway. It still
cannot set a price or invent a business fact: quote totals come from the
price list, FAQ bodies come from knowledge-block ids, and anything
commercial still needs approval. Set `AI_MODEL` to `openai/gpt-4.1-mini`
(or another Gateway id). Anything other than `fake` or `vercel` fails boot.

## Run

```sh
bun run dev        # backend + web together (Ctrl-C stops both)
bun run dev:api    # backend only → http://127.0.0.1:3001
bun run dev:web    # web only → http://127.0.0.1:3000
```

Production-shaped run: `bun run build` then `bun run start:api`
(`node apps/backend/dist/main.js`).

Health check: `curl http://127.0.0.1:3001/health` → `{"status":"ok"}`.
Boot seeds the owner account, so it needs the database to be reachable;
`GET /health` itself still touches no database.

## Check

```sh
bun run check      # architecture check + Biome + typecheck + vitest (fast, no Docker)
```

Components, also runnable individually: `bun run arch`, `bun run lint`,
`bun run typecheck`, `bun run test`, `bun run format`.

The architecture check fails the build if anything under
`apps/backend/src/core/` imports adapters, infrastructure, `apps/web`,
NestJS, Drizzle, zod, `fs`, or any other non-core module.

## Ports

| Service | Default | Notes |
| --- | --- | --- |
| Backend API | 3001 | `PORT` |
| Web | 3000 | `WEB_PORT` |
| PostgreSQL | 5432 | via `docker compose`, user `bos`/`bos` (dev only) |

## Environment variables

See `.env.example` for the full list with safe defaults. Highlights:

| Name | Used by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | backend | Postgres in dev and prod |
| `DB_DIALECT` | backend | `postgres` (default) or `sqlite` (tests/dev only) |
| `CONFIG_DIR` | backend | default `<repo>/config` |
| `BOS_OWNER_EMAIL` / `BOS_OWNER_PASSWORD` | backend | seed owner, created only when no operator credentials exist |
| `BOS_INGRESS_KEY` | backend | bearer token for `POST /inbound/emails` |
| `AI_ADAPTER` | backend | `fake` (default) or `vercel`; anything else fails boot |
| `AI_MODEL` | backend | Gateway model id, required when `AI_ADAPTER=vercel` |
| `AI_GATEWAY_API_KEY` | backend | Gateway key, or an OpenAI `sk-` key, when `AI_ADAPTER=vercel` |
| `OPENAI_API_KEY` | backend | optional OpenAI key; used instead of a gateway key |
| `PUBLIC_APP_URL` | backend | quote links |
| `COOKIE_SECURE` | backend | `true` outside local HTTP |
| `BOS_API_URL` | web | server-only base URL of the BOS API |
| `WEB_PORT` | web | dev server port |

## Configuration

The tenant's identity and behavior come from JSON files under `config/`
(`organization.json`, `mailboxes.json`, `knowledge-base.json`,
`price-list.json`). All files are validated at boot with zod; a missing or
invalid file, a currency mismatch, a non-`none` tax mode without
`taxRateBps`, or zero price rules **fails boot**. There is no empty
fallback. Organization identity never comes from a request body or header.