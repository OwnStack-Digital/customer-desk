import type { Provider } from "@nestjs/common";
import { Argon2PasswordHasher } from "../../../adapters/outbound/runtime/argon2-password-hasher";
import { RandomTokenGenerator } from "../../../adapters/outbound/runtime/random-token-generator";
import { Sha256TokenHasher } from "../../../adapters/outbound/runtime/sha256-token-hasher";
import { SystemClock } from "../../../adapters/outbound/runtime/system-clock";
import { UlidGenerator } from "../../../adapters/outbound/runtime/ulid-id-generator";
import { CLOCK } from "../../../core/ports/clock";
import { ID_GENERATOR } from "../../../core/ports/id-generator";
import { PASSWORD_HASHER } from "../../../core/ports/password-hasher";
import { TOKEN_GENERATOR } from "../../../core/ports/token-generator";
import { TOKEN_HASHER } from "../../../core/ports/token-hasher";

/** Process capabilities: clock, ids, and hashing. Not a Nest module. */
export const runtimeProviders: Provider[] = [
  { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
  { provide: TOKEN_HASHER, useClass: Sha256TokenHasher },
  { provide: TOKEN_GENERATOR, useClass: RandomTokenGenerator },
  { provide: ID_GENERATOR, useClass: UlidGenerator },
  { provide: CLOCK, useClass: SystemClock },
];
