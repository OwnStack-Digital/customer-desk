import type { Provider } from "@nestjs/common";
import { CLOCK, type Clock } from "../../../core/ports/clock";
import {
  ID_GENERATOR,
  type IdGenerator,
} from "../../../core/ports/id-generator";
import {
  OPERATOR_CREDENTIAL_REPOSITORY,
  type OperatorCredentialRepository,
} from "../../../core/ports/operator-credential-repository";
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from "../../../core/ports/password-hasher";
import {
  SESSION_REPOSITORY,
  type SessionRepository,
} from "../../../core/ports/session-repository";
import {
  TOKEN_HASHER,
  type TokenHasher,
} from "../../../core/ports/token-hasher";
import {
  AUTHENTICATE_SESSION,
  AuthenticateSession,
  type AuthenticateSessionDeps,
} from "../../../core/use-cases/authenticate-session";
import { LOGIN, Login } from "../../../core/use-cases/login";
import {
  LOGOUT,
  Logout,
  type LogoutDeps,
} from "../../../core/use-cases/logout";
import {
  SEED_OWNER,
  SeedOwner,
  type SeedOwnerDeps,
} from "../../../core/use-cases/seed-owner";

/** 7-day absolute session lifetime (docs/PLAN.md frozen choices). */
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export const authProviders: Provider[] = [
  {
    provide: LOGIN,
    useFactory: async (
      credentials: OperatorCredentialRepository,
      sessions: SessionRepository,
      hasher: PasswordHasher,
      tokenHasher: TokenHasher,
      clock: Clock,
      ids: IdGenerator,
    ): Promise<Login> =>
      new Login({
        credentials,
        sessions,
        hasher,
        tokenHasher,
        clock,
        ids,
        sessionLifetimeMs: SESSION_LIFETIME_MS,
        // Verified on unknown email so login always performs one argon2
        // verification (constant work; no enumeration via timing).
        dummyHash: await hasher.hash("bos-login-constant-work"),
      }),
    inject: [
      OPERATOR_CREDENTIAL_REPOSITORY,
      SESSION_REPOSITORY,
      PASSWORD_HASHER,
      TOKEN_HASHER,
      CLOCK,
      ID_GENERATOR,
    ],
  },
  {
    provide: AUTHENTICATE_SESSION,
    useFactory: (
      sessions: AuthenticateSessionDeps["sessions"],
      tokenHasher: AuthenticateSessionDeps["tokenHasher"],
      clock: AuthenticateSessionDeps["clock"],
    ): AuthenticateSession =>
      new AuthenticateSession({ sessions, tokenHasher, clock }),
    inject: [SESSION_REPOSITORY, TOKEN_HASHER, CLOCK],
  },
  {
    provide: LOGOUT,
    useFactory: (
      sessions: LogoutDeps["sessions"],
      tokenHasher: LogoutDeps["tokenHasher"],
      clock: LogoutDeps["clock"],
    ): Logout => new Logout({ sessions, tokenHasher, clock }),
    inject: [SESSION_REPOSITORY, TOKEN_HASHER, CLOCK],
  },
  {
    provide: SEED_OWNER,
    useFactory: (
      credentials: SeedOwnerDeps["credentials"],
      hasher: SeedOwnerDeps["hasher"],
      ids: SeedOwnerDeps["ids"],
      clock: SeedOwnerDeps["clock"],
    ): SeedOwner => new SeedOwner({ credentials, hasher, ids, clock }),
    inject: [
      OPERATOR_CREDENTIAL_REPOSITORY,
      PASSWORD_HASHER,
      ID_GENERATOR,
      CLOCK,
    ],
  },
];
