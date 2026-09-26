import { AuthError, type OperatorSession } from "../../domain/auth";
import type { Clock } from "../../ports/clock";
import type { SessionRepository } from "../../ports/session-repository";
import type { TokenHasher } from "../../ports/token-hasher";

export interface AuthenticateSessionDeps {
  readonly sessions: SessionRepository;
  readonly tokenHasher: TokenHasher;
  readonly clock: Clock;
}

/**
 * Validates the opaque cookie session id: present, not revoked, and not
 * expired (absolute lifetime, no refresh). The raw id is never stored or
 * logged; only its hash is looked up.
 */
export class AuthenticateSession {
  constructor(private readonly deps: AuthenticateSessionDeps) {}

  async run(
    organizationId: string,
    sessionToken: string,
  ): Promise<OperatorSession> {
    const session = await this.deps.sessions.findByTokenHash(
      organizationId,
      this.deps.tokenHasher.hash(sessionToken),
    );
    if (
      !session ||
      session.revokedAt !== null ||
      this.deps.clock.now().getTime() >= Date.parse(session.expiresAt)
    ) {
      throw new AuthError(
        "Session is missing or has expired. Please sign in again.",
      );
    }
    return session;
  }
}

/** DI token (composition root only; the use case itself is framework-free). */
export const AUTHENTICATE_SESSION = "AuthenticateSession";
