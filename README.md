# OwnStack Customer Desk — proprietary public preview

**AI prepares customer-email work. People review, approve, and decide.**

Customer Desk (internally BOS) is an early, single-organization operations
workspace: normalized inbound
email becomes a classified conversation, a suggested reply, a price-list-based
quote, or a request for human attention. This repository is a **local evaluation
preview**, not a production deployment guide.

## See the workflow

Actual UI captures from a local demo with synthetic customers and a fictional
cleaning business (not mockups):

![Operator conversation with a priced quote and reply awaiting approval](docs/assets/operator-thread.png)

![Customer quote page after acceptance, with configured line items and tax](docs/assets/customer-quote.png)

The narrated demo uses live AI; the quickstart below uses deterministic fake AI
and needs **no external API key**. Video is available locally as
`artifacts/demo/ownstack-demo.mp4` when generated, or as a release asset if one is
published. It is not included in Git. See [demo notes and reproduction](docs/demo/README.md).

## What works — and what does not

- Inbox classification, thread summaries, human-review filters, and complaint escalation.
- Replies grounded in configured knowledge-base facts; prices and tax calculated
  in application code, not invented by the model.
- Draft editing, internal assistant instructions, explicit approval, then a
  separate action to queue a message in the outbox.
- Token-based customer quote pages: accept, decline, and send a question.
- Service requests captured as internal notes; operator takeover pauses automation.
- Normalized ingress with replay deduplication and reference-based threading.

**Queueing is not email delivery.** There is no mailbox sync or delivery worker.
Service notes do not change calendars; quote acceptance is not booking or payment.
Unknown work or missing quantities need human review and may create a proposed
clarification draft, not a priced quote. Fake AI is a development fixture, not a
quality benchmark for live models. See [preview limitations and publication checklist](docs/PREVIEW.md).

## Local quickstart (Docker-free)

Requirements: **Node.js 24, latest patch** (locally tested with 24.11.0), **Bun 1.3.13**, and a shell.
Bun installs dependencies and runs scripts; NestJS and Next.js run on Node, not the
Bun runtime. SQLite is for local evaluation/tests only.

From the repository root, in **Bash**:

```bash
bun install --frozen-lockfile
# Optional template; never overwrite an existing local file.
[ -e .env ] || cp .env.example .env

# Explicit exports override any existing local .env (including live AI).
export AI_ADAPTER=fake
export DB_DIALECT=sqlite
export DATABASE_URL="$PWD/bos-preview.sqlite"
export BOS_OWNER_EMAIL=owner@example.test
read -r -s -p "Choose a local owner password: " BOS_OWNER_PASSWORD
export BOS_OWNER_PASSWORD
printf '\n'
export BOS_INGRESS_KEY="$(openssl rand -hex 32)"
export PORT=3001 WEB_PORT=3000
export BOS_API_URL=http://127.0.0.1:3001
export PUBLIC_APP_URL=http://127.0.0.1:3000
export COOKIE_SECURE=false
export CONFIG_DIR="$PWD/config"

bun run db:migrate
bun run dev
```

Open **http://127.0.0.1:3000/login** and sign in with the email and password you
supplied. Boot seeds one owner only when the credential table is empty; changing
these exports does not reset an existing owner's password. Keep this database
and credentials local. Use a fresh database path for a fresh evaluation.

Use free ports, or change `PORT`, `WEB_PORT`, `BOS_API_URL`, and `PUBLIC_APP_URL`
together. Do not build into a web directory already serving a running dev app.
Health: `curl http://127.0.0.1:3001/health` returns `{"status":"ok"}`.

### Add a synthetic email

In another Bash terminal, export the **same local ingress key** as the API
(`BOS_INGRESS_KEY`; do not share or commit it). Then:

```bash
curl --fail-with-body http://127.0.0.1:3001/inbound/emails \
  -H "Authorization: Bearer $BOS_INGRESS_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
    "mailboxId": "mbx_harbour_pine",
    "sourceMessageId": "preview-quote-1",
    "messageId": "<preview-quote-1@example.test>",
    "from": {"address": "customer@example.test", "name": "Demo Customer"},
    "to": ["hello@harbourandpine.example"],
    "subject": "Oven cleaning quote",
    "text": "Hi, how much for an oven clean?",
    "receivedAt": "2026-01-01T10:00:00.000Z"
  }'
```

A new receipt returns 201 with ids and processing status; replaying this same
mailbox/source id returns 200 with `duplicate: true`. A processing failure still
commits the receipt. The mailbox id must match `config/mailboxes.json`. Threads
join through `inReplyTo`/`references`, never subject alone.

### PostgreSQL option

Instead of SQLite, use a disposable local PostgreSQL 17 database. The included
Compose file uses **development-only** `bos`/`bos` credentials:

```bash
docker compose up -d postgres
export DB_DIALECT=postgres
export DATABASE_URL=postgres://bos:bos@127.0.0.1:5432/bos
bun run db:migrate
bun run dev
```

Keep the other quickstart exports. An existing PostgreSQL instance works too:
supply its URL instead of running Docker. Never use production data or credentials.

## Development and checks

```bash
bun run check          # architecture + lint + typecheck + deterministic tests
bun run build          # backend + web (use a separate copy if web is running)
bun run test:pg        # optional: starts local Compose PostgreSQL, concurrency test
# Existing disposable DB instead (role must be able to CREATE DATABASE):
TEST_DATABASE_URL='postgres://user@127.0.0.1:5432/disposable_db' bun run test:pg:service
```

Tests force `AI_ADAPTER=fake` regardless of a local live-AI `.env`. The PostgreSQL
spec skips without `TEST_DATABASE_URL`; unit/HTTP acceptance tests use fakes and
SQLite. CI installs from the frozen lockfile, runs checks/builds, scans Git history
for secrets, and exercises concurrency against a disposable PostgreSQL service.

Individual commands: `bun run arch`, `bun run lint`, `bun run typecheck`,
`bun run test`, `bun run format`. `bun run dev:api` and `bun run dev:web` start
services separately; built API: `bun run start:api`. A passing build does not mean
production readiness.

## Repository map and configuration

```text
apps/backend   NestJS API, framework-free application core, persistence adapters
apps/web       Next.js operator UI and customer quote pages
config/        Fictional tenant, mailboxes, knowledge base, price list
scripts/       Architecture checks, dev runner, optional demo media tools
docs/          Architecture, plans, preview boundaries, demo narrative
```

The four tenant JSON files are validated at boot and fail closed on missing or
invalid configuration. Organization identity comes from configuration, not
request headers. `.env.example` documents environment variables. `AI_ADAPTER=fake`
is the default; optional `vercel` requires a model and provider credentials and
sends customer content to that provider. Do not enable it with private data for
this preview. Review the adapters and provider terms before any live experiment.

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Architecture](docs/ARCHITECTURE.md)

**Proprietary public preview:** the [preview license](LICENSE) permits inspection
and local, non-production evaluation with synthetic data. It does not grant
production, commercial reuse, or redistribution rights. This is not open-source
software; public GitHub visibility does not change that. Third-party dependencies
retain their own licenses.
