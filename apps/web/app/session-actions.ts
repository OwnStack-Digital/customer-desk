"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { bosApiRaw } from "../lib/bos-api";

export async function logoutAction() {
  const jar = await cookies();
  const session = jar.get("bos_session")?.value;
  if (session) {
    try {
      await bosApiRaw("/auth/logout", {
        method: "POST",
        headers: { cookie: `bos_session=${session}` },
      });
    } catch {
      // Local sign-out must still work when the API is unavailable.
    }
  }
  jar.delete("bos_session");
  redirect("/login");
}
