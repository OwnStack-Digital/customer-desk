# BOS — Implementation plan

**Company:** OwnStack · **Product:** BOS (v3)

Executable slices from the current docs-only repo to a core demonstrator, then a pilot. Product behavior stays in [`PRODUCT.md`](./PRODUCT.md). Boundaries stay in [`ARCHITECTURE.md`](./ARCHITECTURE.md). Stack choices stay in [`DECISIONS.md`](./DECISIONS.md). This file is the task list and the contracts those docs deferred (“freeze in the first plan”, “DTOs land in the first implementation plan”).

Do not port `ownstack-bos-v2`. No `packages/*`, industry packs, grading engine, policy engine, multi-org, or RLS.

## How to execute

1. Implement **one slice at a time**, in order. A slice is done only when its acceptance checks pass.
2. Do not start slice N+1 to “unblock” a failing check in slice N.
3. Add a port method, table, or route only when the current slice needs it.
4. If a slice needs a behavior change, edit `PRODUCT.md` or `ARCHITECTURE.md` first. Do not silently diverge.
5. Pilot slices stay closed until the demonstrator gate passes.

Mark a task `[x]` in this file when it is done. Do not add a second backlog.

## Frozen choices

| Choice | Decision |
| --- | --- |
| Session | Cookie `bos_session` holds an opaque id. Database stores **SHA-256** of that id. Logout revokes the row. |
| Session life | 7 days, absolute, no refresh token. `HttpOnly`, `SameSite=Lax`, `Secure` when `COOKIE_SECURE=true`, `Path=/`. |
| Password | Argon2id, OWASP parameters (19 MiB, iterations 2, parallelism 1). Node binding, not pure JS. |
| Seed owner | If `operator_credentials` is empty at boot, create one user from `BOS_OWNER_EMAIL` and `BOS_OWNER_PASSWORD`. Never commit the password. |
| IDs | ULID strings from `IdGenerator`. Tests inject the generator. No database-generated ids. |
| Lint | Biome only. |
| Web → API | `BOS_API_URL` HTTP only (dev default `http://127.0.0.1:3001`). Next copies `Set-Cookie` on login/logout. |
| LLM | No vendor in the demonstrator. `AI_ADAPTER=fake` only. |
| Config format | JSON under `config/`. Invalid file fails boot. No YAML, no empty fallback. |
| Quantities | Positive integers only. |
| Money math | Integer minor units. Round half up, once per line. Tax total is the sum of rounded line taxes, not a second rounding of the subtotal. |
| Quote link host | `PUBLIC_APP_URL` (the Next app), path `/quote/<token>`. API never puts the raw token in logs. |
| CORS | No browser CORS on owner or public routes. Ingress is a non-browser client. |
| Shared types | No shared package. HTTP JSON below is copied into `apps/web/lib/bos-api.ts`. |

### Env

| Name | Used by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | backend | Postgres in dev and prod |
| `DB_DIALECT` | backend | `postgres` or `sqlite` (tests/dev only) |
| `CONFIG_DIR` | backend | default `<repo>/config` |
| `BOS_OWNER_EMAIL` / `BOS_OWNER_PASSWORD` | backend | seed only |
| `BOS_INGRESS_KEY` | backend | bearer token for `POST /inbound/emails` |
| `PUBLIC_APP_URL` | backend | quote links |
| `COOKIE_SECURE` | backend | `true` outside local HTTP |
| `PORT` | backend | default `3001` |
| `BOS_API_URL` | web | server-only |
| `WEB_PORT` | web | default `3000` |

Organization id comes from `config/organization.json`, never from a request body or header.

## Contracts

### Error body

```json
{ "error": { "code": "stale_revision", "message": "Approval does not match the current draft revision." } }
```

| HTTP | `code` | When |
| --- | --- | --- |
| 401 | `unauthorized` | missing/expired/revoked session, or bad ingress key |
| 403 | `forbidden` | authenticated but not allowed (unused beyond a stable shape in v3) |
| 404 | `not_found` | unknown id, unknown/expired/revoked quote token |
| 409 | `conflict` | stale revision, already consumed, conflicting quote decision, duplicate decision mismatch |
| 422 | `validation` | malformed body, unknown enum, non-positive quantity |

Duplicate ingress is **200**, not 409: receipt already happened. Concurrent send of the same approved revision is **200** with the existing outbound message.

### Owner and ingress auth

- Owner routes: cookie only.
- `POST /inbound/emails`: `Authorization: Bearer <BOS_INGRESS_KEY>`, compared in constant time. The key maps to the single `mailboxId` in config. Body `mailboxId` must match or the call is `422`.
- Public quote routes: unguessable token only. No session.

### HTTP surface (demonstrator)

Ingress:

```http
POST /inbound/emails
```

Body is the `InboundEmail` DTO from `ARCHITECTURE.md`. Response:

```json
{ "messageId": "01ARZ3NDEKTSV4RRFFQ69G5FAV", "conversationId": "01ARZ3NDEKTSV4RRFFQ69G5FAV", "duplicate": false, "processing": "ready" }
```

`processing` is the status after the post-commit process attempt: `ready`, `needs_human`, or `failed`. A processing failure still returns **201** for a new message. Duplicate returns **200** and does not restart processing.

Owner:

| Method | Path | Body / result |
| --- | --- | --- |
| POST | `/auth/login` | `{ email, password }` → `{ operator: { email } }` + `Set-Cookie` |
| POST | `/auth/logout` | revoke session, clear cookie |
| GET | `/inbox?filter=all\|needs_human\|complaints` | `InboxPage` |
| GET | `/threads/:conversationId` | `Thread` |
| POST | `/threads/:conversationId/drafts/:revisionId` | `{ action: "edit", bodyText }` or `{ action: "approve" }` or `{ action: "discard" }` |
| POST | `/threads/:conversationId/take-over` | pauses automatic draft replacement |
| POST | `/threads/:conversationId/quote-decision` | `{ quoteVersionId, decision: "accept"\|"decline" }` for an operator-confirmed quote reply |
| POST | `/drafts/:revisionId/send` | `{ revisionId }` redundant path id must match body; idempotent |
| GET | `/outbox` | queued/failed/uncertain rows; demonstrator has no `sent` from a provider |
| POST | `/messages/:messageId/retry-processing` | new processing revision |

Public:

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/public/quotes/:token` | display only; scanners must not decide |
| POST | `/public/quotes/:token/decision` | `{ decision: "accept"\|"decline" }` |

No delivery-trigger route in the demonstrator.

### JSON shapes the UI needs

```ts
type InboxItem = {
  conversationId: string
  from: { address: string; name?: string }
  subject?: string
  latestAt: string
  lane?: "faq" | "quote" | "service" | "complaint" | "quote_reply" | "other" | "noise"
  processing: "pending" | "processing" | "ready" | "needs_human" | "failed"
  urgent: boolean
  automationPaused: boolean
  preview: string
}

type Thread = {
  conversation: {
    id: string
    customer: { address: string; name?: string }
    subject?: string
    automationPaused: boolean
  }
  messages: Array<{
    id: string
    direction: "inbound" | "outbound"
    at: string
    from: string
    subject?: string
    text?: string
    delivery?: "queued" | "sending" | "sent" | "failed" | "uncertain"
  }>
  processing?: {
    status: InboxItem["processing"]
    lane?: InboxItem["lane"]
    summary: string
  }
  serviceNote?: { request: string; supplied: string[]; missing: string[]; nextAction: string }
  draft?: {
    revisionId: string
    status: "proposed" | "approved"
    bodyText: string
    assumptions: string[]
    totalMinor?: number
    currency?: string
  }
  openQuote?: { quoteVersionId: string; status: string; totalMinor: number; currency: string }
}

type PublicQuote = {
  businessName: string
  status: "sent" | "accepted" | "declined" | "superseded" | "expired"
  currency: string
  lines: Array<{ name: string; quantity?: number; amountMinor: number }>
  assumptions: string[]
  subtotalMinor: number
  taxMinor: number
  totalMinor: number
  validUntil: string
  canDecide: boolean
}
```

HTML bodies are stored and are not returned to the demonstrator UI. Attachments are not rendered; their presence is a processing fact, not a download.

### Classifier and drafter ports

`ClassifierPort` returns slots. It never returns prices, tax, or a permission to send.

```ts
type Classification = {
  lane: "faq" | "quote" | "service" | "complaint" | "quote_reply" | "other" | "noise"
  confidence: "high" | "low"
  quoteRequest?: { lines: Array<{ ruleId?: string; label: string; quantity?: number }> }
  faqFactIds?: string[]
  service?: { request: string; supplied: string[]; missing: string[]; nextAction: string }
  quoteReply?: { intent: "accept" | "decline" | "change" | "unclear" }
  summary: string
}
```

`DrafterPort` returns optional non-binding wording only: `{ greeting?: string; closing?: string }`. The use case builds the customer-visible body.

Fake classifier, first match:

1. Subject prefix `[bos:faq|quote|service|complaint|quote_reply|other|noise|fail|low]` wins. `fail` throws a timeout-style error. `low` forces `confidence: "low"` and human review on whatever lane the rest of the subject would be, else `other`.
2. Complaint words (`complaint`, `unhappy`, `refund`, `terrible`, `damaged`) win over every other lane.
3. Else if `inReplyTo` / `references` hit a stored outbound quote message, lane is `quote_reply`. Intent from `accept`, `decline`, or `change`; otherwise `unclear`.
4. Else quote words (`quote`, `how much`, `price`, `estimate`) → `quote`.
5. Else service words (`book`, `reschedule`, `cancel the`, `move the`) → `service`.
6. Else FAQ words (`hours`, `areas`, `included`, `how booking`) → `faq`, selecting fact ids whose tags match.
7. Else noise (`mailer-daemon`, `noreply`, `unsubscribe`) → `noise`.
8. Else `other` at low confidence.

Low confidence never parks as noise. Mixed complaint + quote is complaint.

### Body rendering

Customer-visible substance is rendered in code.

- FAQ body = greeting + selected knowledge-block texts in fact-id order + explicit unknown line if a asked topic has no block + closing.
- Quote body = greeting + deterministic lines, assumptions, totals, validity, and accept link + closing.
- Wording that contains a currency symbol, a digit, or the words `guarantee`, `booked`, `paid`, `fault`, `sorry we` is dropped. The deterministic body still requires approval.
- Complaint optional draft is the fixed sentence `Thanks — the owner will reply personally.` No model apology.
- Service results are internal notes, not outbound drafts.

### Pricing inputs

`buildQuote` is a pure function. Unsupported or unpriceable work does **not** produce a sendable quote; processing becomes `needs_human` with the interpretation attached.

- Every requested line must match a rule id or a configured alias. Unknown work → human.
- `per_unit` without a quantity and without `defaultQuantity` → human. A configured default is recorded as an assumption, distinct from a customer-supplied quantity.
- `minimumChargeMinor` raises the line and is listed as an assumption.
- Operators recalculate by changing inputs through a later edit of the extracted lines (slice 6). They cannot type a free-form price into the body and have it become the total.

### Take-over and retry

- Take-over sets `conversation.automationPaused`. Later mail is still classified and still raises complaint / human items. It does not supersede a draft.
- `RetryMessageProcessing` appends a processing revision. It must not supersede a draft that was edited, approved, discarded, or consumed. An untouched original proposed draft may be superseded by the retry result.

### Tables

One Postgres schema (`pg-core`) is the source of truth. SQLite tests use a mirrored schema (`text` JSON instead of `jsonb`). A test fails if table or column names diverge.

Add tables in the slice that first writes them. Every operational table has `organization_id`.

| Table | First slice | Constraints that matter |
| --- | --- | --- |
| `operator_credentials` | 1 | unique email |
| `operator_sessions` | 1 | unique `token_hash`; `revoked_at` nullable |
| `conversations` | 2 | customer snapshot; `automation_paused` |
| `messages` | 2 | unique `(mailbox_id, source_message_id)` for inbound |
| `processing_revisions` | 3 | unique `(message_id, revision_number)` |
| `draft_revisions` | 4 | unique `outbound_message_id` when set; status enum |
| `outbox_entries` | 5 | unique `message_id` |
| `audit_events` | 5 | no body, credential, or raw token columns |
| `quote_versions` | 6 | unique `token_hash`; money integers |

`UnitOfWork` wraps the send transaction (outbound message + outbox + audit + draft consume) and the quote-decision transaction. Receipt commits **before** processing; processing failure must not roll receipt back.

### Config files (created in slice 0)

- `config/organization.json` — id, name, timezone, currency, from-address, quote validity days, tax mode, mailbox id
- `config/knowledge-base.json` — version, blocks `{ id, tags, text }`
- `config/price-list.json` — version, currency, tax mode, `taxRateBps` required unless tax mode is `none`, rules `fixed` and `per_unit`
- `config/mailboxes.json` — one mailbox id bound to the ingress key

Sample tenant: fictional cleaner **Harbour & Pine Cleaning**, `Australia/Sydney`, AUD, tax `exclusive`, `taxRateBps: 1000`, 14-day quote validity. Include a regular clean (`per_unit`, bedroom, minimum charge), an oven clean (`fixed`), hours, suburbs served, what is included, and how booking works.

## Demonstrator gate

The demonstrator is done when all of the following are true on a fresh database:

1. Owner can log in and open the inbox on a phone-width browser.
2. Posted fixtures for every lane are classified and visible. Failures stay visible.
3. FAQ draft cites only knowledge-block ids. Quote totals match the price list. Assumptions are visible.
4. Approve then send creates one outbound message and one `queued` outbox row. A second send returns the same message.
5. Public accept/decline requires an explicit POST. GET does not decide. Conflicting decision is 409.
6. Complaint is urgent and has no auto-send. Quote-reply email does not change quote state until the operator confirms.
7. Core import check passes. Use-case tests use fakes only. Concurrent send is proven on Postgres.

## Slice 0 — Scaffold and boot validation

**Outcome:** monorepo boots, config fails closed, dependency rule is enforced. No business behavior yet.

**Depends on:** nothing.

- [x] **0.1** Bun workspace root: `apps/backend`, `apps/web`, TypeScript strict, `tsconfig` project references or standalone app configs. Scripts: `dev`, `typecheck`, `test`, `lint`.
- [x] **0.2** Biome at the repo root. One format command. No ESLint, no Prettier.
- [x] **0.3** `apps/backend` Nest shell with only `AppModule`, `PersistenceModule`, `ConfigModule`, `AiModule`, `EmailModule`, `ApiModule`. Health route `GET /health`. Core folder exists and is empty of framework imports.
- [x] **0.4** `scripts/architecture-check.ts`: fail if `apps/backend/src/core` imports `adapters`, `infrastructure`, `apps/web`, `@nestjs/*`, `drizzle-orm`, `fs`, `node:fs`, `zod`, or a vendor SDK. Wire it into `bun run check`.
- [x] **0.5** Docker Compose Postgres for local dev. Document ports in a root README. `.env.example` lists the env table above with no secrets filled.
- [x] **0.6** Drizzle client selected by `DB_DIALECT` inside `PersistenceModule` only. Migration runner command. No tables yet.
- [x] **0.7** Config loader in `ConfigModule`: read the four JSON files, validate, expose ports. Boot refuses missing fields, currency mismatch between org and price list, tax mode other than `none` without `taxRateBps`, or zero rules. Sample Harbour & Pine files committed.
- [x] **0.8** `apps/web` Next App Router shell with a server-only `lib/bos-api.ts` that reads `BOS_API_URL`. Placeholder home page. No backend imports.
- [x] **0.9** Structured logger in infrastructure with a redaction test for `authorization`, `cookie`, `password`, `token`, and raw email body keys.

**Acceptance:** `bun run check` passes; moving the price-list currency fails boot; a deliberate `@nestjs/common` import under `core/` fails the architecture check.

## Slice 1 — One-org auth

**Outcome:** seeded owner can obtain a session; one owner route rejects anonymous calls.

**Depends on:** slice 0.

- [x] **1.1** Migration: `operator_credentials`, `operator_sessions`.
- [x] **1.2** `OperatorCredentialRepository`, `SessionRepository`, `PasswordHasher`, `Clock`, `IdGenerator` ports. Hasher and id generator are infrastructure adapters. Use cases stay free of Nest.
- [x] **1.3** `Login` and `Logout` use cases. Wrong password and unknown email return the same 401. Seed-on-boot when the credential table is empty.
- [x] **1.4** `POST /auth/login`, `POST /auth/logout`, session guard. `GET /inbox` exists and returns `{ items: [] }` only with a live session.
- [x] **1.5** Next login page: Server Action calls the API and forwards `Set-Cookie`. A logged-in server render of `/inbox` calls `GET /inbox` with the cookie.

**Acceptance:** use-case tests cover wrong password, expired session, and logout revocation without a database. HTTP test covers 401 then 200. No session id appears in logs.

## Slice 2 — Receive and list

**Outcome:** normalized email is durable, idempotent, threaded, and visible.

**Depends on:** slice 1.

- [x] **2.1** Migration: `conversations`, `messages`.
- [x] **2.2** `ReceiveInboundEmail`: validate DTO, dedupe on `(mailboxId, sourceMessageId)`, thread by `inReplyTo` / `references` against stored RFC ids in that mailbox only, otherwise create a conversation. Never match on subject or sender alone.
- [x] **2.3** Commit the message as stored before any classifier call. This slice may leave processing `pending` and skip the classifier.
- [x] **2.4** `ListInbox` and `GetThread`. Newest activity first. Text preview only.
- [x] **2.5** `POST /inbound/emails` with bearer auth. Duplicate returns the original ids and `duplicate: true`.
- [x] **2.6** Inbox UI lists items from the API. Thread page shows inbound text. Empty and error states are visible. Layout is usable at 390px width; no component library.

**Acceptance:** fixture pair proves a reply threads and an unrelated same-subject email does not. Replay does not insert a second message. Web has no Drizzle import.

## Slice 3 — Process with fakes

**Outcome:** every lane and failure path is durable and visible. Draft wording can still be a placeholder.

**Depends on:** slice 2.

- [x] **3.1** Migration: `processing_revisions`.
- [x] **3.2** `ProcessInboundMessage` status machine: `pending → processing → ready | needs_human | failed`. Complaint precedence and low-confidence rule implemented here, not in the controller.
- [x] **3.3** Fake `ClassifierPort` implementing the contract above. `AiModule` binds the fake. No live model client.
- [x] **3.4** After receipt commits, call processing. A thrown classifier records `failed` and still returns 201. Noise is parked with no draft. `other` and low confidence are `needs_human`.
- [x] **3.5** `RetryMessageProcessing` appends a revision and is idempotent while a revision is already `processing`.
- [x] **3.6** Inbox filter `needs_human` and `complaints`. Complaint rows show urgent. Thread shows lane, status, and summary.

**Acceptance:** one fixture per lane plus duplicate ingress, mixed complaint, classifier throw, and `[bos:low]`. None of these delete the message.

## Slice 4 — Knowledge base and FAQ draft

**Outcome:** FAQ replies are grounded. Missing facts stay unknown.

**Depends on:** slice 3.

- [x] **4.1** Migration: `draft_revisions` (quote columns nullable until slice 6).
- [x] **4.2** `ReviewDraft` is not required yet, but creating a `proposed` FAQ revision is. Store fact ids and knowledge-base version on the revision.
- [x] **4.3** Renderer builds the body from blocks. Drafter wording is optional and dropped when it violates the digit/currency/promise checks.
- [x] **4.4** No supporting fact → `needs_human` and a body that says what is unknown. Do not answer from model knowledge.
- [x] **4.5** Thread UI shows the proposed FAQ body and the fact ids used.

**Acceptance:** a draft cannot contain a factual sentence that is absent from the selected blocks. Knowledge-base version is persisted. HTML-only mail with no text becomes `needs_human`.

## Slice 5 — Approve and queue outbound

**Outcome:** an exact revision can be approved and sent into the outbox. Delivery is not claimed.

**Depends on:** slice 4.

- [x] **5.1** Migration: `outbox_entries`, `audit_events`.
- [x] **5.2** `ReviewDraft`: edit creates a new proposed revision and supersedes the old one; approve binds one revision; discard is terminal. Any edit clears approval.
- [x] **5.3** `SendApprovedDraft` in one unit of work: immutable outbound `Message`, `queued` outbox row, audit event, draft `consumed`. Same approved revision sent twice returns the first message. Stale revision is 409.
- [x] **5.4** Take-over endpoint. While paused, a new inbound FAQ must not replace the current draft; classification still updates.
- [x] **5.5** Recording `EmailSenderPort` is bound and unused by HTTP. No route marks an outbox row `sent`.
- [x] **5.6** Thread actions: edit, approve, discard, send, take over. Outbox page lists queued rows and last error column (empty in the happy path).

**Acceptance:** use-case tests cover edit-invalidates-approval, discard, take-over, and send idempotency with in-memory ports. A Postgres test runs two concurrent sends and asserts one outbound message. Rollback test: a forced audit failure leaves no message and no consumed draft.

## Slice 6 — Price and quote decision

**Outcome:** quotes are versioned, priced in code, and decided only by an explicit post.

**Depends on:** slice 5.

- [x] **6.1** Pure `buildQuote` plus domain tests: fixed, per-unit, minimum charge, default quantity as assumption, missing quantity, unknown line, tax exclusive, tax inclusive, tax none, half-up rounding.
- [x] **6.2** Migration: `quote_versions`. Token stored as SHA-256. Raw token exists only in the outbound body and the send response path that embeds the link.
- [x] **6.3** Quote lane creates `prepared` version + proposed draft whose amounts come from the renderer. Unpriceable mail is `needs_human` and has no sendable draft.
- [x] **6.4** Send moves that quote version `prepared → sent`, sets validity from organization config, and revokes the token of any previous sent version on that conversation (supersede).
- [x] **6.5** `RecordQuoteDecision` for the public token. GET is read-only. Same decision replays. Conflicting decision is 409. Expired, superseded, or unknown token is 404. Acceptance does not create a payment or booking row.
- [x] **6.6** Next `/quote/[token]`: SSR display, then an explicit confirm control posting accept or decline. Buttons are not plain links.

**Acceptance:** changing the price list does not change an already sent version. A link scanner that only GETs leaves status `sent`. Domain tests never open a database.

## Slice 7 — Service, complaint, quote reply

**Outcome:** the non-quote lanes finish at a clear owner action. This closes the demonstrator.

**Depends on:** slice 6.

- [x] **7.1** Service lane stores the internal note on the processing artifact and shows it on the thread. No outbound draft.
- [x] **7.2** Complaint lane is urgent, `needs_human`, optional fixed draft only, and is excluded from any send-without-approval path. There is no such path anyway; add a test that send requires `approved`.
- [x] **7.3** Quote-reply lane stores candidate quote ids and extracted intent. It does not call `RecordQuoteDecision`. Operator confirm endpoint records the decision or, for `change` / no match / multiple matches, leaves a human item.
- [x] **7.4** Attachment metadata with no usable text stays `needs_human` across lanes.
- [x] **7.5** Golden path fixture: inbound quote → thread → process → approve → send → outbox queued → public accept. Plus one complaint fixture that never creates an outbox row by itself.

**Acceptance:** demonstrator gate list above. Then stop. Do not open pilot work in the same change.

## Pilot slices (closed)

Start these only after the demonstrator gate is checked off in this file.

### Slice 8 — One mailbox and real delivery

- [ ] **8.1** Inbound connector maps one provider to `InboundEmail` and posts to the ingress route. MIME parsing stays in the connector.
- [ ] **8.2** `DeliverQueuedEmail` use case: `queued → sending → sent | failed | uncertain`. `sent` means provider acceptance. Uncertain is not retried blindly.
- [ ] **8.3** Delivery worker calls that use case. It is not a Nest module per entity and it does not import repositories except through the use case.
- [ ] **8.4** Record the chosen provider and LLM vendor in `DECISIONS.md` before adding either real adapter. LLM remains behind the existing ports.

### Slice 9 — Operability

- [ ] **9.1** UI shows processing and outbox failures with a retry action that calls the existing routes.
- [ ] **9.2** Correlation id on request, message, and conversation logs. Redaction test extended to quote tokens.
- [ ] **9.3** Backup/restore drill documented and run once against Postgres.
- [ ] **9.4** Acceptance fixtures from `ARCHITECTURE.md` run as a named suite, including expired and replayed quote decisions.

### Slice 10 — Pilot gate

Do not call the product pilot-ready until a real mailbox has passed mixed mail, complaint visibility, phone approval/send, and quote accept/decline. Polish, admin UI, and a second channel stay deferred.

## Explicit non-tasks

Config admin UI · auto-acknowledgements · attachment OCR · manual thread merge · multi-org · extra roles · payments · scheduling · workflow engine · WhatsApp · PDF quotes · shared `packages/domain` · MySQL · Bun as the Nest production runtime · a live LLM in slices 0–7.
