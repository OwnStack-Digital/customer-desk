import { hash, verify } from "@node-rs/argon2";
import type { PasswordHasher } from "../../../core/ports/password-hasher";

/**
 * Argon2id with the OWASP-recommended parameters from docs/PLAN.md
 * (19 MiB memory, 2 iterations, parallelism 1). Native binding, not pure JS.
 */
export class Argon2PasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return hash(password, {
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  verify(password: string, passwordHash: string): Promise<boolean> {
    return verify(passwordHash, password);
  }
}
