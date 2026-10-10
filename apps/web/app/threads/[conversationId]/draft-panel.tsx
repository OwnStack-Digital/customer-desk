"use client";

import { useState } from "react";
import { Icon } from "../../../components/icon";
import { SubmitButton } from "../../../components/submit-button";
import { Badge } from "../../../components/ui";
import type { ThreadDraft } from "../../../lib/bos-api";
import { approveDraft, discardDraft, editDraft, sendDraft } from "./actions";

export function DraftPanel({
  draft,
  conversationId,
}: {
  draft: ThreadDraft;
  conversationId: string;
}) {
  const [body, setBody] = useState(draft.bodyText);
  const dirty = body !== draft.bodyText;
  const fields = (
    <>
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="revisionId" value={draft.revisionId} />
    </>
  );
  return (
    <section className="panel draft-panel" id="draft">
      <div className="panel-heading">
        <div className="section-title">
          <Icon name="spark" />
          <h2>Suggested reply</h2>
        </div>
        <Badge tone={draft.status === "approved" ? "green" : "amber"}>
          {draft.status === "approved" ? "Approved" : "Awaiting approval"}
        </Badge>
      </div>
      <div className="panel-body stack">
        <p className="muted small">
          {draft.status === "approved"
            ? "Approved and ready to queue. Editing creates a new draft that needs approval."
            : "Review the reply below. Nothing is sent until you approve and send."}
        </p>
        <form action={editDraft} className="stack">
          {fields}
          <label htmlFor="draft-body" className="sr-only">
            Draft reply
          </label>
          <textarea
            id="draft-body"
            name="bodyText"
            rows={12}
            required
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <div className="actions-row">
            <SubmitButton
              variant="secondary"
              pendingLabel="Saving…"
              disabled={!dirty}
            >
              Save changes
            </SubmitButton>
            {dirty ? (
              <span className="small unsaved-note" role="status">
                Unsaved changes
              </span>
            ) : (
              <span className="muted small">Saved draft</span>
            )}
          </div>
        </form>
        {draft.assumptions.length > 0 ? (
          <div className="notice notice-amber">
            <strong>Check before approving</strong>
            <ul>
              {draft.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {draft.factIds?.length ? (
          <p className="fact-note">
            <Icon name="shield" size={14} />
            Based on {draft.factIds.length} knowledge base fact
            {draft.factIds.length === 1 ? "" : "s"}.
          </p>
        ) : null}
        {dirty ? (
          <p className="small muted">
            Save your changes before approving or sending.
          </p>
        ) : null}
        <div className="draft-footer">
          <form action={draft.status === "approved" ? sendDraft : approveDraft}>
            {fields}
            <SubmitButton
              disabled={dirty}
              pendingLabel={
                draft.status === "approved" ? "Queuing…" : "Approving…"
              }
            >
              {
                <Icon
                  name={draft.status === "approved" ? "send" : "check"}
                  size={16}
                />
              }
              {draft.status === "approved" ? "Send to outbox" : "Approve reply"}
            </SubmitButton>
          </form>
          <form action={discardDraft}>
            {fields}
            <SubmitButton
              variant="danger"
              confirmMessage="Discard this draft? Any unsaved edits will also be lost."
              pendingLabel="Discarding…"
            >
              Discard
            </SubmitButton>
          </form>
        </div>
      </div>
    </section>
  );
}
