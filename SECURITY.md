# Security for this preview

This is a local evaluation preview, not a hardened or supported production
service. There is no supported-version matrix, response SLA, or production
security guarantee. Use synthetic data, disposable databases, and fake AI.

## Reporting a suspected vulnerability

Do not post secrets, customer data, exploit details, or usable quote tokens in a
public issue. If GitHub private vulnerability reporting is enabled on the
published repository, use **Security → Report a vulnerability**. Otherwise use an
existing private contact with the repository owner and ask for a secure reporting
channel before sending sensitive details. A reporting contact and GitHub private
reporting availability still need to be confirmed before publication.

Include affected revision, a minimal synthetic reproduction, impact, and relevant
sanitized logs. Do not probe systems you do not own. No bug bounty or response
commitment is implied.

## Local handling

- Keep `.env` variants, ingress keys, passwords, database files, recordings, and
  private local scripts out of Git. Ignore rules do not remove previously tracked
  files or secrets from history; review both before publication.
- Quote links are bearer capabilities. Treat their tokens like credentials;
  never publish a usable link to real records. Preview screenshots use synthetic
  records and do not expose quote URLs.
- The default fake AI needs no provider credentials. Optional live AI transmits
  message content to the configured provider; review privacy and provider terms
  first. The optional narration tool also uses an external speech service.
- Approval and outbox queueing are separate gates. There is no delivery worker,
  mailbox connector, calendar integration, or payment processing in this preview.
- `COOKIE_SECURE=false` and Compose credentials are for local development only.
  Do not expose the preview or its development database to the internet.

CI uses read-only repository permissions, no production secrets, and a disposable
loopback PostgreSQL service. It checks dependencies from the frozen lockfile and
scans Git history with checksum-verified Gitleaks. Dependency advisories change;
run `bun audit` before publishing and investigate findings rather than assuming
passing tests prove security. Publication and dependency review remain explicit
owner decisions; see [the checklist](docs/PREVIEW.md).

## Dependency maintenance in this preview

The lockfile upgrades Next within 15.5, Drizzle ORM within 0.45, and the test
runner to Vitest 4.1 to resolve reported advisories. Root overrides keep held-back
transitive tools patched: PostCSS 8.5.28 (Next's pinned PostCSS), sharp 0.35.5
(Next's optional image processor), source-map-js 1.2.2 (source-map denial of
service), and esbuild 0.28.2 (Drizzle Kit's legacy loader otherwise brings an
affected esbuild). Builds, SQLite migrations, tests, and PostgreSQL concurrency
are checked against this lockfile. Revisit overrides when upstream constraints
include the fixes; do not remove them solely to quiet package-manager warnings.
