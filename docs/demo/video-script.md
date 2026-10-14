# OwnStack BOS: AI preparation, human control

Target: a short, approximately two-minute product demo, 1600×900, with natural English neural narration and scene captions. Recorded against the actual application, using live GPT-4.1-mini and synthetic customers. Local SQLite database; no real mailbox connection or email delivery.

## 1. One inbox, less sorting
**Screen:** Open the operator inbox. Show request categories, review count, and the quote conversation through search.
**Voiceover:** “Meet OwnStack: one workspace for customer email. AI sorts incoming requests, prepares useful work, and flags what needs a person. Your team stays in control.”
**Caption:** AI prepares. People decide.

## 2. From request to quote
**Screen:** Open Emma’s request for 3 bedrooms, 2 bathrooms, a kitchen and a living area. Scroll from the request to the quote summary showing AUD407 including tax.
**Voiceover:** “Emma asks for a home-cleaning quote. The assistant identifies the services and quantities. Prices and tax come from the configured price list, not the model. A four-hundred-and-seven-dollar quote is prepared, but nothing has been sent.”
**Caption:** Real request → price-list-based quote

## 3. Ask the assistant to revise
**Screen:** In Ask the assistant, type “Add an oven clean to this quote. Keep the original rooms and quantities.” Click Update draft. Show the new quote, AUD478.50.
**Voiceover:** “Need to change the scope? Give the assistant an internal instruction. Here, we add an oven clean and keep the original rooms. The quote is recalculated, and the new reply still needs approval.”
**Caption:** Internal instructions. Recalculated quote.

## 4. Human review is a real gate
**Screen:** Edit the greeting in Suggested reply, Save changes, Approve reply, then separately Send to outbox. Show the resulting timeline.
**Voiceover:** “The operator reviews the draft, edits the greeting, and saves a new revision. Approval and sending are separate actions. Only after both steps does the message enter the outbox, with the activity recorded in the conversation.”
**Caption:** Review → edit → approve → queue

## 5. A clear customer decision
**Screen:** Open the actual public link from the queued message. Show line items, subtotal, tax and total. Click Accept quote and show Accepted.
**Voiceover:** “The customer gets a clear quote page with line items, tax, and a total. They can accept, decline, or ask a question. Emma accepts, and that decision is saved against this quote.”
**Caption:** Customer portal: quote, conversation, decision

## 6. Grounded answers
**Screen:** Open Oliver’s hours-and-service-areas enquiry. Show the suggested reply and “Based on 2 knowledge base facts.”
**Voiceover:** “For routine questions, the assistant prepares replies grounded in your knowledge base, like opening hours and service areas. These answers remain drafts until a person approves them.”
**Caption:** Knowledge-base answers, still reviewed

## 7. Service requests without false promises
**Screen:** Open Mia’s rescheduling request. Scroll to the internal service note with supplied address and next step.
**Voiceover:** “Booking changes become internal service notes, capturing the request, supplied details, and next action. The system does not pretend a calendar change has happened. Your team confirms availability.”
**Caption:** Capture the request. Confirm availability.

## 8. Escalation and takeover
**Screen:** Complaints inbox filter, Noah’s urgent complaint, Take over conversation, Automation paused. Return to Needs review and show Ava’s unusual sponsorship request.
**Voiceover:** “Complaints are flagged for urgent human attention. An operator can take over and pause automation. Unusual or uncertain requests also go to review, rather than getting an invented answer.”
**Caption:** Escalate uncertainty. Keep a human in control.

## 9. Close on the outbox
**Screen:** Open Outbox with Emma’s queued message. End card: “AI handles preparation. You own the decision.” Small footnote: “Local demo · live AI · synthetic data · no email delivery”.
**Voiceover:** “That’s OwnStack: faster preparation, with human control at every important step. This local demo uses live AI and synthetic data. Messages are queued, not delivered.”
**Caption:** Faster preparation. Human control.

## Claims intentionally excluded
No claim of automatic booking, job-status lookup, payment, mailbox synchronization, or actual email delivery. Service notes are not calendar operations. The inbox Needs review filter is for escalated processing, not all unapproved drafts. Prices are calculated in application code. Public quote acceptance is not payment or scheduling.
