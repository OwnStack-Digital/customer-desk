import { describe, expect, it } from "vitest";
import type { OperatorCredential, OperatorSession } from "../domain/auth";
import { AuthError } from "../domain/auth";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { OperatorCredentialRepository } from "../ports/operator-credential-repository";
import type { PasswordHasher } from "../ports/password-hasher";
import type { SessionRepository } from "../ports/session-repository";
import { AuthenticateSession } from "./authenticate-session";
import { Login } from "./login";
import { Logout } from "./logout";
import { SeedOwner } from "./seed-owner";

const ORG = "org_test";
const EMAIL = "owner@example.test";
const PASSWORD = "correct horse battery staple";
const LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

class FakeClock implements Clock {
  current = new Date("2025-06-01T00:00:00.000Z");
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  now(): Date {
    return this.current;
  }
}

class FakeIdGenerator implements IdGenerator {
  private seq = 0;
  nextId(): string {
    this.seq += 1;
    return `ulid-${this.seq}`;
  }
}

class FakeHasher implements PasswordHasher {
  readonly verifyCalls: Array<{ password: string; hash: string }> = [];
  hash(password: string): Promise<string> {
    return Promise.resolve(`fake:${password}`);
  }
  verify(password: string, hash: string): Promise<boolean> {
    this.verifyCalls.push({ password, hash });
    return Promise.resolve(hash === `fake:${password}`);
  }
}

class FakeCredentials implements OperatorCredentialRepository {
  readonly rows: OperatorCredential[] = [];
  findByEmail(organizationId: string, email: string) {
    return Promise.resolve(
      this.rows.find(
        (row) => row.organizationId === organizationId && row.email === email,
      ),
    );
  }
  create(credential: OperatorCredential) {
    this.rows.push(credential);
    return Promise.resolve();
  }
  count(organizationId: string) {
    return Promise.resolve(
      this.rows.filter((row) => row.organizationId === organizationId).length,
    );
  }
}

class FakeSessions implements SessionRepository {
  readonly rows: OperatorSession[] = [];
  create(session: OperatorSession) {
    this.rows.push(session);
    return Promise.resolve();
  }
  findByTokenHash(organizationId: string, tokenHash: string) {
    return Promise.resolve(
      this.rows.find(
        (row) =>
          row.organizationId === organizationId && row.tokenHash === tokenHash,
      ),
    );
  }
  revoke(sessionId: string, revokedAt: string) {
    const row = this.rows.find((item) => item.id === sessionId);
    if (row) {
      (row as { revokedAt: string | null }).revokedAt = revokedAt;
    }
    return Promise.resolve();
  }
}

function harness() {
  const clock = new FakeClock();
  const hasher = new FakeHasher();
  const credentials = new FakeCredentials();
  const sessions = new FakeSessions();
  const login = new Login({
    credentials,
    sessions,
    hasher,
    tokenHasher: { hash: (token) => `hashed:${token}` },
    clock,
    ids: new FakeIdGenerator(),
    sessionLifetimeMs: LIFETIME_MS,
    dummyHash: "fake:not-the-password",
  });
  const authenticate = new AuthenticateSession({
    sessions,
    tokenHasher: { hash: (token) => `hashed:${token}` },
    clock,
  });
  const logout = new Logout({
    sessions,
    tokenHasher: { hash: (token) => `hashed:${token}` },
    clock,
  });
  return { clock, hasher, credentials, sessions, login, authenticate, logout };
}

async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (error) {
    return error as AuthError;
  }
  throw new Error("expected the call to fail");
}

async function seedOwner(credentials: FakeCredentials): Promise<void> {
  await credentials.create({
    id: "ulid-owner",
    organizationId: ORG,
    email: EMAIL,
    passwordHash: `fake:${PASSWORD}`,
    createdAt: "2025-01-01T00:00:00.000Z",
  });
}

describe("Login", () => {
  it("creates a session for the correct password and stores only the hashed token", async () => {
    const h = harness();
    await seedOwner(h.credentials);
    const result = await h.login.run(ORG, EMAIL, PASSWORD);
    expect(result.operator).toEqual({ email: EMAIL });
    expect(result.sessionToken).toBe("ulid-1");
    const stored = h.sessions.rows[0];
    expect(stored.tokenHash).not.toBe(result.sessionToken);
    expect(stored.tokenHash).toBe(`hashed:${result.sessionToken}`);
    expect(stored.revokedAt).toBeNull();
    expect(Date.parse(stored.expiresAt)).toBe(
      h.clock.now().getTime() + LIFETIME_MS,
    );
  });

  it("rejects a wrong password with the shared auth error", async () => {
    const h = harness();
    await seedOwner(h.credentials);
    await expect(h.login.run(ORG, EMAIL, "wrong")).rejects.toBeInstanceOf(
      AuthError,
    );
    expect(h.sessions.rows).toHaveLength(0);
  });

  it("returns the identical error shape for an unknown email", async () => {
    const h = harness();
    await seedOwner(h.credentials);
    const wrongPasswordError = await failure(h.login.run(ORG, EMAIL, "wrong"));
    const unknownEmailError = await failure(
      h.login.run(ORG, "nobody@example.test", PASSWORD),
    );
    expect(unknownEmailError).toBeInstanceOf(AuthError);
    expect(unknownEmailError.message).toBe(wrongPasswordError.message);
    expect(unknownEmailError.code).toBe(wrongPasswordError.code);
  });

  it("does constant verification work on an unknown email", async () => {
    const h = harness();
    await h.login.run(ORG, "nobody@example.test", PASSWORD).catch(() => null);
    expect(h.hasher.verifyCalls).toHaveLength(1);
    expect(h.hasher.verifyCalls[0]).toEqual({
      password: PASSWORD,
      hash: "fake:not-the-password",
    });
  });
});

describe("AuthenticateSession", () => {
  it("accepts a live session and rejects it once expired", async () => {
    const h = harness();
    await seedOwner(h.credentials);
    const result = await h.login.run(ORG, EMAIL, PASSWORD);
    await expect(
      h.authenticate.run(ORG, result.sessionToken),
    ).resolves.toBeTruthy();
    h.clock.advance(LIFETIME_MS + 1);
    await expect(
      h.authenticate.run(ORG, result.sessionToken),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects an unknown session id", async () => {
    const h = harness();
    await expect(
      h.authenticate.run(ORG, "no-such-session"),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe("SeedOwner", () => {
  it("seeds the owner when the table is empty, and never twice", async () => {
    const h = harness();
    const seed = new SeedOwner({
      credentials: h.credentials,
      hasher: h.hasher,
      ids: new FakeIdGenerator(),
      clock: h.clock,
    });
    await expect(seed.run(ORG, {})).resolves.toBe("missing_env");
    await expect(
      seed.run(ORG, { email: ` ${EMAIL} `, password: "owner-secret" }),
    ).resolves.toBe("seeded");
    expect(h.credentials.rows[0]?.email).toBe(EMAIL);
    expect(h.credentials.rows[0]?.passwordHash).toBe("fake:owner-secret");
    await expect(
      seed.run(ORG, { email: "other@example.test", password: "x" }),
    ).resolves.toBe("already_populated");
    expect(h.credentials.rows).toHaveLength(1);
  });
});

describe("Logout", () => {
  it("makes the session unusable after logout", async () => {
    const h = harness();
    await seedOwner(h.credentials);
    const result = await h.login.run(ORG, EMAIL, PASSWORD);
    await h.logout.run(ORG, result.sessionToken);
    expect(h.sessions.rows[0]?.revokedAt).not.toBeNull();
    await expect(
      h.authenticate.run(ORG, result.sessionToken),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("is idempotent for missing and already-revoked sessions", async () => {
    const h = harness();
    await expect(h.logout.run(ORG, "missing")).resolves.toBeUndefined();
    await seedOwner(h.credentials);
    const result = await h.login.run(ORG, EMAIL, PASSWORD);
    await h.logout.run(ORG, result.sessionToken);
    const revokedAt = h.sessions.rows[0]?.revokedAt;
    await h.logout.run(ORG, result.sessionToken);
    expect(h.sessions.rows[0]?.revokedAt).toBe(revokedAt);
  });
});
