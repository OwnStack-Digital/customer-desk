import type { Clock } from "../ports/clock";
import type { SessionRepository } from "../ports/session-repository";
import type { TokenHasher } from "../ports/token-hasher";

export interface LogoutDeps {
  readonly sessions: SessionRepository;
  readonly tokenHasher: TokenHasher;
  readonly clock: Clock;
}

/**
 * Revokes the session row for the opaque cookie session id. Idempotent:
 * missing, expired, or already-revoked sessions are a plain success.
 */
export class Logout {
  constructor(private readonly deps: LogoutDeps) {}

  async run(organizationId: string, sessionToken: string): Promise<void> {
    const session = await this.deps.sessions.findByTokenHash(
      organizationId,
      this.deps.tokenHasher.hash(sessionToken),
    );
    if (!session || session.revokedAt !== null) {
      return;
    }
    await this.deps.sessions.revoke(
      session.id,
      this.deps.clock.now().toISOString(),
    );
  }
}
