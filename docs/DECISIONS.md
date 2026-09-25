# BOS — Implementation decisions

**Company:** OwnStack · **Product:** BOS (v3)

Companion to [`ARCHITECTURE.md`](./ARCHITECTURE.md). Architecture = boundaries and behavior; this file = concrete stack and delivery choices for the core demonstrator. Change decisions here when trade-offs change; do not fork a second architecture story.

## Summary

| Area | Choice |
| --- | --- |
| Monorepo | `apps/backend`, `apps/web`, `config/`, `docs/` |
| Package manager | **Bun** |
| Backend framework | **NestJS** (few modules; core stays plain TypeScript) |
| Backend runtime | **Node.js LTS** (Nest-supported path); Bun optional later |
| Web | **Next.js** App Router (SSR/RSC + Server Actions) — not NestJS |
| UI → domain | Server-side calls into **BOS API**; browser avoids a large public REST surface |
| ORM | **Drizzle** · **PostgreSQL** primary · **SQLite** tests/dev only · **MySQL** deferred |
| Auth (demonstrator) | Single owner user + HTTP-only session cookie on the API |
| AI (demonstrator) | Port + **deterministic fakes** first; real LLM adapter swappable |
| Email delivery (demonstrator) | Outbox rows only; sender port is recording/disabled |

---

## 1. NestJS vs Next.js (names)

| Tool | Role |
| --- | --- |
| **NestJS** | `apps/backend` — HTTP adapters, DI/composition, infrastructure |
| **Next.js** | `apps/web` — operator UI + public quote pages |

“Server-side UI work without hand-writing browser APIs” is a **Next.js** concern (RSC, Server Actions, optional thin BFF). NestJS does not replace the web app.

This matches architecture: web never imports core; connectors and tests still hit the real **BOS API**.

---

## 2. Bun

**Chosen:** Bun as **package manager and script runner** for the monorepo (`bun install`, `bun run`, lockfile).

**Backend process:** run Nest on **Node.js LTS** for the demonstrator.

| Why | Detail |
| --- | --- |
| Nest stance | Nest is Node-first; Bun is usable experimentally, not the supported production path |
| Risk | Decorators, `reflect-metadata`, some Nest/HTTP adapter edge cases still favor Node |
| Speed | Bun still helps install/scripts/tests without coupling the API process to Bun |

**Revisit:** Bun-as-Nest-runtime only after smoke tests on auth, Drizzle, and multipart-free JSON APIs pass; keep Node as the documented deploy runtime until then.

**Next.js:** Node for `next build` / production start unless team validates Bun for the chosen Next version.

---

## 3. NestJS shape (few modules)

Nest is the **composition shell**, not the place to mirror every domain noun as a module.

### Keep outside Nest

- `core/domain/*`
- `core/use-cases/*`
- `core/ports/*`

Plain TypeScript. No Nest decorators, no `@InjectRepository` in use cases. Use cases receive ports via constructor params from the composition root.

### Nest modules (intentionally few)

| Module | Responsibility |
| --- | --- |
| `AppModule` | root wiring only |
| `PersistenceModule` | Drizzle client/driver, `UnitOfWork`, repository **adapters** |
| `ConfigModule` | load/validate file config; org/KB/price-list adapters |
| `AiModule` | `ClassifierPort` / `DrafterPort` adapters (fake or LLM) |
| `EmailModule` | `EmailSenderPort` (disabled/recording in demonstrator) |
| `ApiModule` | HTTP controllers + auth guards only |

Do **not** create one Nest module per use case, lane, or entity. Controllers call use-case functions/classes; they do not own business rules.

### HTTP adapter groups (controllers, not modules)

- Owner (session): inbox, thread, drafts, send, outbox, retry  
- Inbound email (connector credential)  
- Public quote (token)  

Delivery trigger stays deferred until pilot (or a tiny internal controller later).

---

## 4. Database and ORM

### Policy

**Drizzle · Postgres primary · SQLite allowed for tests/dev only · MySQL deferred**

### Engine by environment

| Environment | Engine | Notes |
| --- | --- | --- |
| Production | **PostgreSQL** | Source of truth for concurrency, outbox, pilot |
| Local day-to-day | **PostgreSQL** via Docker Compose (preferred) | Same engine as prod |
| Tests / quick dev | **SQLite** (file or `:memory:`) allowed | Speed; not a prod substitute |
| MySQL | **Deferred** | No schema/adapter work in demonstrator |

SQLite may green tests that would race under multi-writer Postgres. Any transaction, unique-constraint, or concurrent-send proof needed for pilot confidence runs on **Postgres**.

### ORM: Drizzle

**Why Drizzle**

- Fits hexagonal adapters: explicit SQL/transactions behind ports  
- Light runtime; no client generate step in the hot path  
- First-class **PostgreSQL** and **SQLite** dialects  
- Nest wires driver + schema in `PersistenceModule` only; `core/` never imports Drizzle  

**Dialect layout (expected)**

- Primary schema: `pg-core` tables/migrations for Postgres  
- Test/dev SQLite: separate `sqlite-core` mapping or mirrored test schema — **do not** pretend one table helper serves both  
- Composition root selects driver from env (`DATABASE_URL` / `DB_DIALECT`)  
- `UnitOfWork` = Drizzle transaction wrapper used by use cases via the port  

### Schema conventions (Postgres-first)

- String ids (ULID/UUID text) from `IdGenerator`  
- Money as integer minor units  
- Timestamps stored UTC  
- Prefer portable columns where SQLite tests share meaning; Postgres-only features (e.g. advanced jsonb ops, `LISTEN`) only when needed and covered on Postgres  
- Unique `(mailboxId, sourceMessageId)` and send/outbox invariants enforced in DB + use cases  

### Access rule

- **Only** `apps/backend` persistence adapters use Drizzle  
- `apps/web` never opens the operational database  
- In-memory fakes remain valid for pure use-case tests without any SQL engine  

---

## 5. Web app: Next.js and “no browser API sprawl”

### Chosen pattern

```text
Browser  →  Next.js (RSC / Server Actions / route handlers)
                 │  server-only HTTP (cookie/session forwarded)
                 ▼
            BOS API (NestJS)  →  use cases  →  ports
```

| UI need | Mechanism |
| --- | --- |
| Load inbox/thread/draft | Server Component or Server Action → `bos-api` client |
| Approve / edit / send / take over | Server Action → owner API |
| Public quote view | SSR page → public quote GET |
| Accept / decline | Explicit Server Action or form POST → public quote decision |

**Intent:** the browser does not need a wide CORS REST surface for every operator click. Most UI logic is server-side in Next, still **transport-only** to the BOS API.

### Still required: real BOS HTTP API

| Consumer | Why API stays explicit |
| --- | --- |
| Email connector / test client | Normalized ingress |
| Contract/acceptance tests | Stable surface |
| Future worker | Delivery trigger |
| Optional mobile/other clients | Same owner API |

So: **minimize browser-facing API design work**, do **not** delete the backend API or call Drizzle/use cases from Next.

### Next layout (minimal)

```text
apps/web/
  app/
    (auth)/login/
    (owner)/inbox/
    (owner)/threads/[id]/
    (owner)/outbox/
    quote/[token]/
  lib/bos-api.ts          # server-only client
  # no core/, no drizzle/, no domain ports
```

Optional Next route handlers: cookie bridge/BFF only—no domain rules, no second quote engine.

---

## 6. Auth (demonstrator)

| Decision | Choice |
| --- | --- |
| Actors | One deployment = one org; one **owner** operator is enough |
| Credentials | Username/email + password from env or seeded config (not a full IdP) |
| Session | Opaque session id; **HTTP-only secure cookie** issued by BOS API |
| Next | Server-side fetch forwards cookie; no session DB in Next |
| Public quote | No operator session; unguessable token only |
| Ingress | Shared secret / API key bound to `mailboxId` (header), not operator cookie |

CSRF: prefer same-site cookie strategy + Server Actions posting to Next origin; Next server calls API with cookie or internal session forward. Finalize header names at API sketch time.

**Pilot+:** replace with stronger identity only if needed; keep one-role model.

---

## 7. AI, email, config

| Port | Demonstrator | Pilot |
| --- | --- | --- |
| `ClassifierPort` / `DrafterPort` | Deterministic **fake** (fixture keywords / subject rules) | Real LLM adapter behind same ports |
| `EmailSenderPort` | Disabled or recording fake | Provider adapter + worker |
| File config | Required at startup; invalid → refuse boot | Same until admin API exists |

Fake classifier must cover every lane and failure path used in acceptance fixtures so UI and use cases do not depend on a live model.

---

## 8. API surface (sketch to freeze in planning)

Not full OpenAPI yet—stable groups for the first slices:

| Group | Examples | Auth |
| --- | --- | --- |
| Owner | `POST /auth/login`, `POST /auth/logout`, `GET /inbox`, `GET /threads/:id`, draft review/send, `GET /outbox`, `POST /messages/:id/retry-processing` | Session |
| Ingress | `POST /inbound/emails` | Connector credential |
| Public | `GET /public/quotes/:token`, `POST /public/quotes/:token/decision` | Quote token |

Owner **write** semantics the UI relies on:

- Edit draft → new or updated revision per architecture rules  
- Approve binds exact revision  
- Send is idempotent under concurrency  
- Take over is conversation-level  
- Quote decision: accept | decline only on public path; change-requests stay owner-side  

Error classes to standardize early: `401`, `403`, `404`, `409` (conflict/stale/idempotent replay), `422` (validation).

Detailed DTOs land in the first implementation plan, not in architecture prose.

---

## 9. Persistence sketch (planning input)

Logical records (Drizzle table schema later):  
`Conversation`, `Message`, `ProcessingRevision`, `DraftRevision`, `QuoteVersion`, `OutboxEntry`, `AuditEvent`, `OperatorSession` (or equivalent), org key on operational rows.

Must-have constraints:

- Unique `(mailboxId, sourceMessageId)`  
- Approval/send consume exact `DraftRevision`  
- Quote tokens stored **hashed**  
- Money as integer minor units  

IDs: string ULIDs (or UUIDs) allocated via `IdGenerator` port.

---

## 10. Config examples (to add under `config/` at implementation start)

Minimum files (schemas validated at boot):

- `organization` — name, timezone, currency, from-address, quote validity period, tax mode  
- `knowledge-base` — versioned blocks with stable fact IDs  
- `price-list` — version, currency, `fixed` / `per_unit` rules  
- mailbox id(s) for ingress binding  

One fictional cleaner/trades sample set ships with the demonstrator.

---

## 11. Tooling

| Tool | Choice |
| --- | --- |
| Language | TypeScript strict |
| Monorepo | Bun workspaces (`apps/*`) |
| API test | Nest testing + use-case tests with in-memory/fake ports |
| Web | Next.js App Router; Playwright later for golden UI path (not required on day one) |
| Lint/format | Biome or ESLint+Prettier — pick at scaffold; one toolchain only |
| Local DB | Docker Compose PostgreSQL (primary); SQLite optional for tests/dev |
| CI (when added) | install, typecheck, unit/use-case tests; SQLite and/or Postgres migrate + API contract tests |

Shared package policy (demonstrator): **avoid** early `packages/domain` extraction. Duplicate types at HTTP boundary if needed; extract only when backend and web churn the same DTO set.

---

## 12. Explicit non-choices (for now)

- Nest as the UI framework  
- Next.js talking to Drizzle/core directly  
- One Nest module per entity/use case  
- Bun as the sole supported Nest production runtime  
- Prisma  
- MySQL support in the demonstrator  
- SQLite as production or sole “prod-like” proof DB  
- Multi-provider auth, magic links, SSO  
- Real mailbox/LLM required to start coding  

---

## 13. Open items (small; freeze in first plan)

1. Exact session store (DB table vs signed cookie)  
2. Password hashing scheme (e.g. Argon2id) and seed user source  
3. ULID vs UUID  
4. Biome vs ESLint/Prettier  
5. Whether Server Actions call BOS API over `localhost` HTTP or a tighter in-network URL only  
6. First LLM vendor when fakes are replaced (does not affect ports)

None of these block scaffolding `apps/backend` + `apps/web` + Drizzle + sample config.

---

## 14. Implementation readiness gate

Planning/implementation may start when this file is accepted and the first plan includes:

1. Scaffold monorepo (Bun workspaces, Nest backend, Next web, Drizzle, Compose Postgres; SQLite test path optional)  
2. Auth session + one protected owner route  
3. `ReceiveInboundEmail` → DB → `ListInbox`  
4. Fake `ProcessInboundMessage` path  
5. Next owner inbox via Server Action/`bos-api` (no direct DB)  

Vertical slices after that follow `ARCHITECTURE.md` build order.

---

*Decisions track choices; `ARCHITECTURE.md` remains the system source of truth for boundaries and domain behavior.*
