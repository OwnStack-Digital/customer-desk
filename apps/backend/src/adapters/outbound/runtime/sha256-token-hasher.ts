import { createHash } from "node:crypto";
import type { TokenHasher } from "../../../core/ports/token-hasher";

/** SHA-256 hex digest: the only form of a session id that is persisted. */
export class Sha256TokenHasher implements TokenHasher {
  hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
