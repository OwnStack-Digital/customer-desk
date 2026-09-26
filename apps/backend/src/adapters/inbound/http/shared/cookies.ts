/** Extracts one cookie value from a raw `Cookie` header (no middleware). */
export function readCookie(
  headers: Record<string, unknown>,
  name: string,
): string | undefined {
  const header = headers.cookie;
  if (typeof header !== "string") {
    return undefined;
  }
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) {
      continue;
    }
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

export const SESSION_COOKIE = "bos_session";

/** Frozen cookie flags: HttpOnly, SameSite=Lax, Path=/, Secure when set. */
export function sessionCookieOptions(): {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.COOKIE_SECURE === "true",
  };
}
