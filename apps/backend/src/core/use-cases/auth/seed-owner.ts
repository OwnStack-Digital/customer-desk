import type { Clock } from "../../ports/clock";
import type { IdGenerator } from "../../ports/id-generator";
import type { OperatorCredentialRepository } from "../../ports/operator-credential-repository";
import type { PasswordHasher } from "../../ports/password-hasher";

export interface SeedOwnerDeps {
  readonly credentials: OperatorCredentialRepository;
  readonly hasher: PasswordHasher;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export interface SeedOwnerInput {
  readonly email?: string;
  readonly password?: string;
}

export type SeedOwnerResult =
  /** Table was empty and the owner credential was created. */
  | "seeded"
  /** Table already has credentials; nothing to do. */
  | "already_populated"
  /** Table was empty but the owner env credentials were not provided. */
  | "missing_env";

/**
 * Creates the owner login when (and only when) the credential table for this
 * organization is empty. The password is passed in, never logged.
 */
export class SeedOwner {
  constructor(private readonly deps: SeedOwnerDeps) {}

  async run(
    organizationId: string,
    owner: SeedOwnerInput,
  ): Promise<SeedOwnerResult> {
    if ((await this.deps.credentials.count(organizationId)) > 0) {
      return "already_populated";
    }
    const email = owner.email?.trim().toLowerCase();
    const password = owner.password;
    if (!email || !password) {
      return "missing_env";
    }
    const createdAt = this.deps.clock.now();
    await this.deps.credentials.create({
      id: this.deps.ids.nextId(),
      organizationId,
      email,
      passwordHash: await this.deps.hasher.hash(password),
      createdAt: createdAt.toISOString(),
    });
    return "seeded";
  }
}

/** DI token (composition root only; the use case itself is framework-free). */
export const SEED_OWNER = "SeedOwner";
