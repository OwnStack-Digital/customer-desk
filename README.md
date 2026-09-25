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
bun run db:migrate         # applies migrations (no-op until tables land)
```

## Run

```sh
bun run dev        # backend + web together (Ctrl-C stops both)
bun run dev:api    # backend only → http://127.0.0.1:3001
bun run dev:web    # web only → http://127.0.0.1:3000
```

Production-shaped run: `bun run build` then `bun run start:api`
(`node apps/backend/dist/main.js`).

Health check: `curl http://127.0.0.1:3001/health` → `{"status":"ok"}`.
Boot and health never require a database connection.

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