import type { OperatorSession } from "../domain/auth";

/** Stored operator sessions for this deployment's single organization. */
export interface SessionRepository {
  create(session: OperatorSession): Promise<void>;

  findByTokenHash(
    organizationId: string,
    tokenHash: string,
  ): Promise<OperatorSession | undefined>;

  /** Sets `revokedAt`; idempotent for already-revoked sessions. */
  revoke(sessionId: string, revokedAt: string): Promise<void>;
}

export const SESSION_REPOSITORY = "SessionRepository";
