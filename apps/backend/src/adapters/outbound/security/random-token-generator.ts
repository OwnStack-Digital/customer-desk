import { randomBytes } from "node:crypto";
import type { TokenGenerator } from "../../../core/ports/token-generator";

/**
 * Unguessable public quote tokens (PLAN.md slice 6): 32 random bytes,
 * base64url-encoded (43 characters, URL-safe). The raw token exists only
 * inside the outbound message link; every store, log, and API response
 * carries its SHA-256 instead.
 */
export class RandomTokenGenerator implements TokenGenerator {
  nextToken(): string {
    return randomBytes(32).toString("base64url");
  }
}
