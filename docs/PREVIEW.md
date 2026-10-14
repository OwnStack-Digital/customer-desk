# Preview boundaries and publication checklist

## Intended use

OwnStack Customer Desk is a proprietary public preview for local evaluation of
one configured organization's customer-email workflow, with synthetic data.
The [preview license](../LICENSE) allows this limited evaluation, not production
or commercial reuse. The checked-in Harbour & Pine tenant is a fictional fixture.
This is not a hosted service, deployment recommendation, or production-readiness
claim. Architecture and product plans may describe future work; only implemented
behavior is represented in the README and demo.

## Current boundaries

- Normalized inbound HTTP ingress, not Gmail/Outlook sync or mailbox polling.
- Reviewable drafts and queued outbox entries, not email transport or delivery.
- Deterministic configured prices/tax and knowledge-block facts; uncertain or
  unpriceable requests require human review. Clarification drafts do not constitute
  priced quotes and still require approval.
- Public quote decisions and customer messages, not payments, scheduling, or job
  fulfillment. A token grants access to that quote's customer conversation.
- Service notes and operator takeover, not calendar mutation or job-status lookup.
- A single configured organization and seeded owner account, not a general
  multi-tenant onboarding or role-management product.
- SQLite is an evaluation/test path. PostgreSQL is supported by the persistence
  adapters, but that alone is not a production operational/security assessment.
- Fake AI is deterministic and offline. Optional live AI can fail and transmits
  input to a provider; the recorded demo is not a promise of repeatable model output.
- No production hardening, backups/recovery plan, abuse/rate-limit guarantee,
  availability SLA, or integration/delivery guarantee is asserted.

## Known validation caveat

Intermittent HTTP test failures were observed during dependency-update validation.
Diagnostics and fixture server lifecycles were improved without changing business
rules or relaxing assertions. The earlier missing-draft/helper failures have no
confirmed cause and are not claimed fixed. See [validation notes](demo/README.md).
Run the final checks again and review the first hosted CI result before publication.

## Before making this repository public

These are **owner/reviewer checks**, not actions performed by editing this file:

- [x] Owner confirmed public publication as `OwnStack-Digital/customer-desk`.
      Existing Git history is retained; private local files and generated video
      remain excluded.
- [x] Select a license/reuse policy: proprietary public preview with limited local
      evaluation permission, as specified in `LICENSE`.
- [ ] Confirm ownership/contribution rights before sharing the source.
- [ ] Audit the entire Git history and intended tracked tree for secrets. Inspect
      ignored local files without publishing them; rotate any exposed credentials
      and resolve history remediation before publication. Ignore rules alone are
      insufficient. Use secret scanning again on the final publication tree.
- [ ] Review fixtures, screenshots, and any optional release video: synthetic
      customers only, no valid real quote links, personal paths, or private data.
- [ ] Confirm a private security contact and enable GitHub private vulnerability
      reporting where available; do not imply an SLA or bounty.
- [ ] Run frozen install, `bun run check`, backend/web builds, dependency audit,
      and PostgreSQL concurrent-send regression on the final lockfile. Investigate
      advisories; do not silently suppress them.
- [ ] Verify the GitHub workflow actually runs on the chosen repository and review
      its permissions/service isolation. Local checks are not a hosted CI run.
- [ ] Decide whether to attach demo media as release assets. Until then, refer to
      local generation and do not add a broken public video link.
- [ ] Review the final diff and staged paths manually. Never stage `.env`,
      databases, generated recordings, agent state, or `apps/backend/src/scripts.sh`.

The owner selected `OwnStack-Digital/customer-desk`, proprietary preview
licensing, and authorized committing the prepared changes and creating the public
repository. Local preparation and validation alone do not establish hosted CI
success or production readiness.
