"use server";

import { redirect } from "next/navigation";
import { BosApiError, bosApi } from "../../../lib/bos-api";

/**
 * Server actions for the public quote page (PLAN.md task 6.6). Accept and
 * decline are explicit form-button submissions to the public decision
 * route — never plain links — so a link scanner that only GETs can never
 * decide. After deciding, the action re-renders the page, which then
 * displays the read-only result.
 */

async function decide(token: string, decision: "accept" | "decline") {
  try {
    await bosApi(`/public/quotes/${token}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    });
  } catch (error) {
    // Expired/superseded between render and submit: show the outcome page.
    if (error instanceof BosApiError && error.status === 404) {
      redirect(`/quote/${token}`);
    }
    redirect(`/quote/${token}?error=${encodeURIComponent(messageOf(error))}`);
  }
  redirect(`/quote/${token}`);
}

export async function acceptQuote(formData: FormData): Promise<void> {
  await decide(String(formData.get("token") ?? ""), "accept");
}

export async function declineQuote(formData: FormData): Promise<void> {
  await decide(String(formData.get("token") ?? ""), "decline");
}

/** Sends a customer message on a still-visible quote link. */
export async function sendCustomerMessage(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const text = String(formData.get("text") ?? "");
  try {
    await bosApi(`/public/quotes/${token}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (error) {
    if (error instanceof BosApiError && error.status === 404) {
      redirect(`/quote/${token}`);
    }
    redirect(`/quote/${token}?error=${encodeURIComponent(messageOf(error))}`);
  }
  redirect(`/quote/${token}`);
}

function messageOf(error: unknown): string {
  if (error instanceof BosApiError) {
    return error.message;
  }
  return "The quote could not be updated.";
}
