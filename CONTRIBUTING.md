# Contributing to the preview

OwnStack Customer Desk is a proprietary local-evaluation preview under the
[preview license](LICENSE), not an open-source project. Public access does not
grant production or commercial reuse rights. Contribution and ownership terms
must be agreed with the repository owner before submitting patches; this document
is not a contributor license agreement or an assignment of rights.

## Start small

- Use the [README quickstart](README.md) with synthetic data and `AI_ADAPTER=fake`.
- Describe a reproducible problem, expected behavior, and a narrow proposed change.
- Keep business decisions explicit: do not bypass human approval, invent prices,
  claim delivery, or turn service notes into booking confirmations.
- Preserve the architecture boundary: application core imports only core code;
  adapters implement ports; the web app talks to the HTTP API, not persistence.

## Before proposing a change

Use the latest patched Node 24 LTS and Bun 1.3.13 (local validation used
Node 24.11.0), then run:

```sh
bun install --frozen-lockfile
bun run check
bun run build
```

If a web dev process is running, build in a separate source copy instead of
writing into its `.next` directory. For persistence/send changes, also exercise
`bun run test:pg` or supply a disposable `TEST_DATABASE_URL` to
`bun run test:pg:service`. The test creates/drops a scratch database and requires
CREATE DATABASE permission. Never point it at production.

Add source-named regression tests for current behavior; do not weaken assertions
or mock live interfaces to make checks pass. Keep formatting changes scoped.
Report commands, results, limitations, and any skipped PostgreSQL test in the PR.

## Safe reports and media

Never include `.env`, tokens, passwords, private helper scripts, real customer
messages, database files, or machine-local report paths. Use `example.test`
addresses and synthetic input. Review screenshots/video for data and quote tokens
before sharing. Report suspected vulnerabilities privately as described in
[SECURITY.md](SECURITY.md), not in a public issue.
