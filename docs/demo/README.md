# Recorded OwnStack demonstration

## Deliverables

- `artifacts/demo/ownstack-demo.mp4`: 2 minutes 14 seconds, 1600×900 at 30fps, H.264 video and AAC audio. Approximately 10MB.
- `artifacts/demo/ownstack-demo.srt`: optional sentence-level subtitles. Timing within each spoken scene is approximate.
- `artifacts/demo/ownstack-demo-poster.png`: closing-card poster.
- `artifacts/demo/verification.json`: final media checks.
- `docs/demo/video-script.md`: scene actions, narration, and claim boundaries.

The media files are ignored by Git and are not public source-file links. They can
be generated locally or attached separately to a future GitHub release after
review. No application behavior was changed for the recording. The public preview
includes two synthetic UI captures in `docs/assets/`.

## What was demonstrated and verified

Actual UI actions, not mocked screenshots:

1. Live AI triage across six synthetic inbound requests.
2. Emma's home clean priced at AUD407.00 including tax.
3. An internal assistant instruction adds an oven clean; the revised quote is AUD478.50.
4. Operator edits the greeting, saves, approves, and separately queues the reply.
5. A real generated public quote URL displays line items and records acceptance.
6. Opening hours and service areas answered from two knowledge-base facts.
7. Rescheduling request captured as an internal note, without claiming a calendar change.
8. Urgent complaint routed to a human; takeover pauses automation. An unusual sponsorship request stays in human review.
9. Outbox shows one queued message with zero delivery attempts.

Live provider: OpenAI GPT-4.1-mini through the existing Vercel AI SDK adapter. Natural neural voice: `en-US-AriaNeural`, with a slightly faster conversational pace. Only synthetic customer text and the public narration script were used.

## Isolation and safety

Existing services on ports 3000/3001 and 3101 were not changed or stopped. Recording used a disposable SQLite database at `/tmp/bos-video-demo/demo.sqlite`, an isolated copy of the web source, and dedicated ports 43100/43101. No real email was delivered. Temporary recording servers were stopped after completion. The existing `.env` was not modified, printed, or copied into the demo web tree.

The full on-camera flow was first run as a probe, then the database was restored from a pre-probe snapshot before recording. All nine scenes passed browser assertions with no page errors. Final narration audibility was measured in every segment; captions were verified by pixel difference. Final audio levels were approximately −20dB mean across scenes, with no overlaps or scene overruns.

## Re-rendering

Requirements: ffmpeg/ffprobe, Playwright with Chromium, Python 3 with edge-tts,
and Node 24. The scripts import `playwright` normally, or use an explicitly
supplied `PLAYWRIGHT_PATH` pointing to its `index.mjs`. There is no agent-tool or
home-directory dependency. For an isolated tool install, from the repository root:

```bash
export DEMO_TOOLS_DIR="$(mktemp -d)"
npm install --prefix "$DEMO_TOOLS_DIR" playwright
export PLAYWRIGHT_PATH="$DEMO_TOOLS_DIR/node_modules/playwright/index.mjs"
node "$DEMO_TOOLS_DIR/node_modules/playwright/cli.js" install chromium
python3 -m venv "$DEMO_TOOLS_DIR/venv"
"$DEMO_TOOLS_DIR/venv/bin/pip" install edge-tts
# Use this venv's Python for voice.py; it submits narration to an external service.
```

All scripts default to `bos-video-demo` under the system temporary directory
(`/tmp/bos-video-demo` on many Unix systems), API port 43101, and web port 43100.
Override with `DEMO_BUILD_DIR`, `DEMO_API_URL`, and `DEMO_WEB_URL`; keep a consistent
build directory across all steps. `DEMO_OUTPUT_DIR` defaults to `artifacts/demo`.
The recorder deliberately refuses non-local API/web hosts. Supply
`DEMO_PASSWORD` and `DEMO_INGRESS_KEY` explicitly; there are no credential
fallbacks. `DEMO_EMAIL` defaults to `demo@ownstack.example`.

1. Start a separate local API with SQLite, configured tenant files, `PUBLIC_APP_URL` pointing to the isolated web, and synthetic operator/ingress credentials matching the script's `DEMO_EMAIL`, `DEMO_PASSWORD`, and `DEMO_INGRESS_KEY` options. Migrate before boot. The exact recorded scenario uses `AI_ADAPTER=vercel` with explicitly supplied provider credentials; fake AI remains the offline quickstart default, but does not promise the recorded live-model wording/service-note extraction. Never copy a private `.env` into a build tree.
2. Run the copied web app separately with `BOS_API_URL` pointing to that API. Do not reuse an active web build directory.
3. `node scripts/demo/seed.mjs` creates the six scenario threads and `seed.json`.
4. Back up the disposable database. `node scripts/demo/record.mjs --probe` verifies every action but changes demo records. Stop the API, restore the backup, and restart it before recording. Wait for `/health`.
5. Generate narration with `"$DEMO_TOOLS_DIR/venv/bin/python" scripts/demo/voice.py` (or Python 3 in an environment with edge-tts installed). Audio is cached per narration text.
6. `node scripts/demo/record.mjs` records the real actions, writes each scene manifest incrementally, and saves screenshots.
7. `node scripts/demo/render.mjs` creates captions, renders uniform clips, mixes audio separately, and muxes the final MP4.
8. `python3 scripts/demo/verify.py` checks streams, every voice segment, timeline bounds, and caption pixels.
9. Stop only the temporary servers you started. Keep raw recordings outside the repository.

## Validation and known intermittent test failures

At recording time, 315 tests passed, 3 failed, and 1 was skipped with fake AI.
The public-preview preparation corrected the stale assertions without changing
product behavior:

- Unknown work or missing quantity produces a **proposed clarification draft**
  with human-review status, no priced quote, and no outbox entry.
- An empty quote follow-up is `needs_human`, with the unpriceable summary. An
  earlier prepared quote remains visible; no new quote is created.

Vitest now forces `AI_ADAPTER=fake`, including when a local `.env` selects live
AI. Successful checks include 318 passing tests plus one PostgreSQL skip, or 319
passing tests when supplied a disposable PostgreSQL 17 database. Live-AI recording
remains optional and distinct from offline tests.

During updated-lock validation, two intermittent HTTP acceptance failures were
observed: a missing draft in the quote-decision fixture, and a public-quote helper
failure initially masked by cleanup. Stronger preconditions and cleanup diagnostics
were added; 15 targeted runs and five full suites did not reproduce those failures.
Their causes remain unconfirmed, so they are not claimed fixed.

A later independent clean-copy run timed out in all nine draft-review HTTP tests.
The HTTP fixtures now explicitly listen on an ephemeral loopback port and close
at suite teardown, rather than letting Supertest automatically open and close the
server for each request. This is a test-lifecycle change, not a business-rule change;
no tests were skipped or timeouts increased.

Shuffled execution then reproduced two order-dependent assertions: a quote audit
count included other tests' quotes, and a session count included earlier logins.
Both assertions now select their own quote/session and still require exactly one
matching row. The log-capture checks also preserve earlier errors during cleanup.

The final frozen-install copy passed architecture, lint, typechecking, all 319
tests including PostgreSQL, and backend/web builds. All 319 tests also passed with
ten fixed shuffled seeds (1–10). These are validation results for the final fixture
setup, not proof that the earlier unexplained missing-draft/helper failures are
gone. GitHub-hosted CI has not yet run.
