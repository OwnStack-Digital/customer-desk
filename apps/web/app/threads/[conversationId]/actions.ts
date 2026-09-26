"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BosApiError, bosApi, type PriceCatalog } from "../../../lib/bos-api";

/**
 * Plain server actions for the thread page (PLAN.md task 5.6). Each action
 * calls the BOS API over HTTP with the operator's session cookie, then
 * redirects back to the thread so the page re-renders the revalidated
 * state. A missing session or a 401 sends the operator to /login; any
 * other failure is surfaced as an `error` query parameter.
 */

async function sessionCookie(): Promise<string | undefined> {
  return (await cookies()).get("bos_session")?.value;
}

/** Calls the API with the session cookie; maps 401 to /login. */
async function callApi(
  conversationId: string,
  path: string,
  init: RequestInit,
): Promise<void> {
  const session = await sessionCookie();
  if (!session) {
    redirect("/login");
  }
  try {
    const headers = new Headers(init.headers);
    headers.set("cookie", `bos_session=${session}`);
    await bosApi(path, {
      ...init,
      headers,
    });
  } catch (error) {
    if (error instanceof BosApiError && error.status === 401) {
      redirect("/login");
    }
    const message =
      error instanceof Error ? error.message : "The action failed.";
    redirect(`/threads/${conversationId}?error=${encodeURIComponent(message)}`);
  }
}

/** `redirect` only runs on the success path; TypeScript needs a return. */
function back(conversationId: string): never {
  redirect(`/threads/${conversationId}`);
}

export async function approveDraft(formData: FormData): Promise<void> {
  const conversationId = String(formData.get("conversationId") ?? "");
  const revisionId = String(formData.get("revisionId") ?? "");
  await callApi(
    conversationId,
    `/threads/${conversationId}/drafts/${revisionId}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    },
  );
  back(conversationId);
}

export async function editDraft(formData: FormData): Promise<void> {
  const conversationId = String(formData.get("conversationId") ?? "");
  const revisionId = String(formData.get("revisionId") ?? "");
  const bodyText = String(formData.get("bodyText") ?? "");
  await callApi(
    conversationId,
    `/threads/${conversationId}/drafts/${revisionId}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "edit", bodyText }),
    },
  );
  back(conversationId);
}

export async function discardDraft(formData: FormData): Promise<void> {
  const conversationId = String(formData.get("conversationId") ?? "");
  const revisionId = String(formData.get("revisionId") ?? "");
  await callApi(
    conversationId,
    `/threads/${conversationId}/drafts/${revisionId}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "discard" }),
    },
  );
  back(conversationId);
}

export async function sendDraft(formData: FormData): Promise<void> {
  const conversationId = String(formData.get("conversationId") ?? "");
  const revisionId = String(formData.get("revisionId") ?? "");
  await callApi(conversationId, `/drafts/${revisionId}/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ revisionId }),
  });
  back(conversationId);
}

/** Prepares a new quote draft from price-list lines after a decline. */
export async function reviseDeclinedQuote(formData: FormData): Promise<void> {
  const conversationId = String(formData.get("conversationId") ?? "");
  const session = await sessionCookie();
  if (!session) {
    redirect("/login");
  }
  let catalog: PriceCatalog;
  try {
    catalog = await bosApi<PriceCatalog>("/price-list", {
      headers: { cookie: `bos_session=${session}` },
    });
  } catch (error) {
    if (error instanceof BosApiError && error.status === 401) {
      redirect("/login");
    }
    const message =
      error instanceof Error ? error.message : "The price list is unavailable.";
    redirect(`/threads/${conversationId}?error=${encodeURIComponent(message)}`);
  }
  const lines = catalog.rules.flatMap((rule) => {
    if (formData.get(`include_${rule.id}`) !== "on") {
      return [];
    }
    const quantityRaw = String(
      formData.get(`quantity_${rule.id}`) ?? "",
    ).trim();
    if (rule.kind === "per_unit") {
      return [
        {
          ruleId: rule.id,
          label: rule.label,
          quantity: Number(quantityRaw),
        },
      ];
    }
    return [{ ruleId: rule.id, label: rule.label }];
  });
  await callApi(conversationId, `/threads/${conversationId}/quote-revision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lines }),
  });
  back(conversationId);
}

/** Records the customer's emailed accept/decline on the open quote. */
export async function confirmQuoteDecision(formData: FormData): Promise<void> {
  const conversationId = String(formData.get("conversationId") ?? "");
  const quoteVersionId = String(formData.get("quoteVersionId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  await callApi(conversationId, `/threads/${conversationId}/quote-decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quoteVersionId, decision }),
  });
  back(conversationId);
}

/** Queues an operator email on this conversation, with or without a draft. */
export async function sendOperatorMessage(formData: FormData): Promise<void> {
  const conversationId = String(formData.get("conversationId") ?? "");
  const text = String(formData.get("text") ?? "");
  await callApi(conversationId, `/threads/${conversationId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  back(conversationId);
}

/** Re-runs processing for a message whose latest revision failed. */
export async function retryProcessing(formData: FormData): Promise<void> {
  const conversationId = String(formData.get("conversationId") ?? "");
  const messageId = String(formData.get("messageId") ?? "");
  await callApi(conversationId, `/messages/${messageId}/retry-processing`, {
    method: "POST",
  });
  back(conversationId);
}

export async function takeOverConversation(formData: FormData): Promise<void> {
  const conversationId = String(formData.get("conversationId") ?? "");
  await callApi(conversationId, `/threads/${conversationId}/take-over`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  back(conversationId);
}
