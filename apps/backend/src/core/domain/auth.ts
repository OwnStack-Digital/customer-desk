/** One-org auth records. Timestamps are ISO-8601 strings; ids are ULIDs. */
export interface OperatorCredential {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly createdAt: string;
}

export interface OperatorSession {
  readonly id: string;
  readonly organizationId: string;
  /** SHA-256 hex of the opaque cookie session id. The raw id is never stored. */
  readonly tokenHash: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

/**
 * The single authentication failure: unknown email and wrong password return
 * the identical error so callers cannot enumerate accounts.
 */
export class AuthError extends Error {
  readonly code = "unauthorized";

  constructor(message = "Email or password is incorrect.") {
    super(message);
    this.name = "AuthError";
  }
}
