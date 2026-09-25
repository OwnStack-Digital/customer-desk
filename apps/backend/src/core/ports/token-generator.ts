/**
 * Unguessable opaque tokens for public quote links (PLAN.md slice 6).
 * Only the SHA-256 of a generated token is ever stored; the raw token
 * exists solely inside the outbound message link.
 */
export interface TokenGenerator {
  /** One fresh unguessable token, e.g. ≥32 random bytes base64url-encoded. */
  nextToken(): string;
}

/** DI token (composition root only; the use case itself is framework-free). */
export const TOKEN_GENERATOR = "TokenGenerator";
