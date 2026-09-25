"use server";

import { redirect } from "next/navigation";
import { bosApiRaw, forwardSetCookies } from "../../../lib/bos-api";

export interface LoginState {
  error?: string;
}

/**
 * Calls POST /auth/login on the BOS API and forwards its Set-Cookie to the
 * browser. Never inspects or stores credentials beyond this request.
 */
export async function loginAction(
  _state: LoginState | undefined,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  let response: Response;
  try {
    response = await bosApiRaw("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { error: "Cannot reach the BOS API. Is the backend running?" };
  }
  if (!response.ok) {
    // Same message for unknown email and wrong password (no enumeration).
    return { error: "Email or password is incorrect." };
  }
  await forwardSetCookies(response);
  redirect("/inbox");
}
