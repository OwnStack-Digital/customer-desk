import { createHash, timingSafeEqual } from "node:crypto";
import { createLogger } from "../../../infrastructure/logger";

/** Compares a presented bearer key against the configured ingress key. */
export interface IngressKeyComparer {
  matches(presentedKey: string): boolean;
}

/** DI token; the adapter is bound in the API composition root. */
export const INGRESS_KEY_COMPARER = "IngressKeyComparer";

/**
 * Constant-time compare of the presented ingress key against
 * `BOS_INGRESS_KEY`. Both sides are hashed to a fixed length first, so
 * `timingSafeEqual` never bails on unequal lengths and the raw key never
 * reaches anything outside this adapter. When the key is unset, every
 * request is rejected and a warning is logged once.
 */
export class TimingSafeIngressKeyComparer implements IngressKeyComparer {
  private warned = false;

  constructor(private readonly expectedKey: string | undefined) {}

  matches(presentedKey: string): boolean {
    if (typeof this.expectedKey !== "string" || this.expectedKey === "") {
      if (!this.warned) {
        this.warned = true;
        createLogger().warn(
          "BOS_INGRESS_KEY is not set; rejecting all inbound ingress",
        );
      }
      return false;
    }
    const presented = createHash("sha256").update(presentedKey).digest();
    const expected = createHash("sha256").update(this.expectedKey).digest();
    return timingSafeEqual(presented, expected);
  }
}
