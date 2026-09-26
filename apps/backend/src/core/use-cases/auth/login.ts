import { AuthError, type OperatorSession } from "../../domain/auth";
import type { Clock } from "../../ports/clock";
import type { IdGenerator } from "../../ports/id-generator";
import type { OperatorCredentialRepository } from "../../ports/operator-credential-repository";
import type { PasswordHasher } from "../../ports/password-hasher";
import type { SessionRepository } from "../../ports/session-repository";
import type { TokenHasher } from "../../ports/token-hasher";

export interface LoginDeps {
  readonly credentials: OperatorCredentialRepository;
  readonly sessions: SessionRepository;
  readonly hasher: PasswordHasher;
  readonly tokenHasher: TokenHasher;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Absolute session lifetime in milliseconds (7 days in production). */
  readonly sessionLifetimeMs: number;
  /**
   * Hash of an arbitrary string, verified when the email is unknown so that
   * login always performs the same argon2 work and timing cannot reveal
   * account existence.
   */
  readonly dummyHash: string;
}

export interface LoginResult {
  /** Opaque cookie value. Only its SHA-256 hash is persisted. */
  readonly sessionToken: string;
  readonly operator: { readonly email: string };
  readonly expiresAt: string;
}

export class Login {
  constructor(private readonly deps: LoginDeps) {}

  async run(
    organizationId: string,
    email: string,
    password: string,
  ): Promise<LoginResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const credential = await this.deps.credentials.findByEmail(
      organizationId,
      normalizedEmail,
    );
    const ok = await this.deps.hasher.verify(
      password,
      credential ? credential.passwordHash : this.deps.dummyHash,
    );
    if (!credential || !ok) {
      // Identical error for unknown email and wrong password (no enumeration).
      throw new AuthError();
    }
    return this.createSession(organizationId, credential.email);
  }

  private async createSession(
    organizationId: string,
    email: string,
  ): Promise<LoginResult> {
    const sessionToken = this.deps.ids.nextId();
    const createdAt = this.deps.clock.now();
    const expiresAt = new Date(
      createdAt.getTime() + this.deps.sessionLifetimeMs,
    );
    const session: OperatorSession = {
      id: this.deps.ids.nextId(),
      organizationId,
      tokenHash: this.deps.tokenHasher.hash(sessionToken),
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
      createdAt: createdAt.toISOString(),
    };
    await this.deps.sessions.create(session);
    return { sessionToken, operator: { email }, expiresAt: session.expiresAt };
  }
}

/** DI token (composition root only; the use case itself is framework-free). */
export const LOGIN = "Login";
