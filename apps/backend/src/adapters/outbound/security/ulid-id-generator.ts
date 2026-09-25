import { ulid } from "ulid";
import type { IdGenerator } from "../../../core/ports/id-generator";

/**
 * ULID strings for every entity id and opaque session id. ULIDs sort by
 * creation time and carry 80 bits of cryptographic randomness (secure source);
 * ids are never database-generated.
 */
export class UlidGenerator implements IdGenerator {
  nextId(): string {
    return ulid();
  }
}
