# BOS — Product (one page)

**Company:** OwnStack · **Product:** BOS (v3)

## What it is

BOS is OwnStack’s **customer email desk** for small service businesses (cleaners, trades, local services).

It reads every inbound email, figures out what the customer wants, drafts a safe response, and keeps the owner in control of anything that commits the business.

**One job:** customer email in → right draft out → owner approves what matters → history kept.

## Who it’s for

- Owner-operators and small offices (roughly 1–20 people)
- Work that arrives by email: quotes, questions, jobs, complaints
- Already on email; may keep Jobber / Xero / calendar as-is

**Not for:** full field-service suite, autonomous auto-send AI, enterprise ERP.

## Message types we handle

Every inbound email is classified, then handled in one of these lanes:

| Type | What BOS does |
| --- | --- |
| **Quote request** | Draft a priced quote from the price list (assumptions listed if facts are missing) → owner reviews → send → accept/decline |
| **FAQ / info** | Draft an answer from the business knowledge base (hours, areas, what’s included, how booking works) → owner reviews → send |
| **Service request** | Existing or new customer wants work done (book, reschedule, change, cancel) → capture intent clearly → owner/office acts |
| **Complaint / issue** | Escalate to owner immediately with the thread and a short summary — no automated apology that admits fault |
| **Quote reply** | Accept / decline / change request on an open quote → record outcome or queue for owner |
| **Other / unclear** | Store in inbox and flag for a human — never invent a commercial answer |

Spam, bounces, and supplier noise are filtered or parked; they don’t drive customer drafts.

## The product in one loop

```text
Customer emails the business
        ↓
Message stored and threaded
        ↓
Intent classified (quote / FAQ / service / complaint / …)
        ↓
Draft prepared for that lane
  (prices only from the price list; answers only from known business facts)
        ↓
Owner-authorized operator reviews on phone when approval is required
        ↓
Reply sent from the system
        ↓
Full thread + outcomes visible in one place
```

Quote lane continues through accept/decline. Service and complaint lanes end when the owner has a clear next action. FAQ ends when the answer is sent.

## What ships (v3 core)

| Piece | Purpose |
| --- | --- |
| **Inbox** | All customer email in one place, by thread |
| **Classifier** | Routes each message to the right lane |
| **Knowledge base** | Short, owner-controlled facts for FAQ answers (file-managed initially) |
| **Price list** | Catalog + fixed rules for money (quotes only) |
| **Drafts** | AI writes non-binding wording; rules/facts constrain substance |
| **Owner review** | Phone-friendly approve / edit / send / take over |
| **Accept link** | Customer can accept or decline a sent quote |
| **History** | Every message, draft, and decision is kept |

### Hard rules (non-negotiable)

1. **AI never sets the price** — the price list / rules engine does.
2. **AI never invents business facts** — FAQ answers come only from the knowledge base (or the draft says what’s unknown).
3. **Nothing commercial or binding sends without approval by the owner or an owner-authorized operator** — quotes, promises, complaint replies, schedule changes.
4. **Missing quote facts become listed assumptions**, not silent invention.
5. **Acceptance ≠ payment ≠ job booked** — we record the commercial yes/no; scheduling stays with the owner’s tools.
6. **Complaints always go to a human** — draft optional, auto-send never.

Later, owner-enabled fixed acknowledgements (e.g. “we got your email”) may auto-send. They never include prices or commitments.

## What’s deliberately out

- WhatsApp / voice / multi-channel (email only first)
- Full job dispatch, rostering, inventory, accounting
- Replacing Jobber / Xero / Google Calendar
- Deep multi-turn interrogation; heavy policy / grade engines
- Industry-pack frameworks, deposits, payments, PDF factories
- Agency multi-org mode
- Auto-send of quotes, FAQ answers, or complaint replies

If it doesn’t help **handle customer email safely and finish quotes**, it waits.

## Value in one line

> Every customer email becomes a clear draft — quote, answer, service note, or complaint alert — so the owner decides in seconds instead of living in the inbox.

## Success (pilot)

A real cleaning or trades business can:

1. Receive mixed customer email into BOS (quotes, FAQs, service asks, complaints)  
2. See each message classified and drafted (or escalated) correctly  
3. Approve and send quote and FAQ replies from a phone  
4. Capture quote accept/decline  
5. Never lose a complaint in the noise  
6. Spend less owner time on inbox and quoting, without invented prices or fake facts  

## Build order

### Core demonstrator

1. One-org access, conversations/messages, normalized email API + inbox
2. Classify all lanes; failures and uncertain mail remain visible
3. File-managed knowledge base + grounded FAQ draft
4. Draft revision, approval, outbound message + outbox visualization
5. Pure price rules + versioned quote + secure accept/decline
6. Service note, complaint escalation, quote-reply owner review

### Pilot readiness

7. Connect one real mailbox for inbound and outbound email
8. Verify mixed-email handling, complaint visibility, phone approval/send, quote outcomes, and recovery
9. Only then: pilot; polish, admin UI, second channel, and extras wait

---

*This file is the product. Prefer changing this page over growing a doc set.*
