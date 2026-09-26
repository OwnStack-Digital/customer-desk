import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Inject, Injectable } from "@nestjs/common";
import { AuthError } from "../../../../core/domain/auth";
import {
  OPERATOR_CREDENTIAL_REPOSITORY,
  type OperatorCredentialRepository,
} from "../../../../core/ports/operator-credential-repository";
import {
  AUTHENTICATE_SESSION,
  type AuthenticateSession,
} from "../../../../core/use-cases/authenticate-session";
import { CONFIG } from "../../../outbound/config-files/config.module";
import type { ValidatedConfig } from "../../../outbound/config-files/loader";
import { readCookie, SESSION_COOKIE } from "./cookies";

/** Request field the guard sets after resolving the operator identity. */
export const OPERATOR_EMAIL_KEY = "bosOperatorEmail";

/** The per-request operator identity set by {@link SessionGuard}. */
export interface OperatorRequest {
  [OPERATOR_EMAIL_KEY]?: string;
}

/** The resolved operator email for the guarded request (never `undefined`). */
export function operatorEmailOf(request: OperatorRequest): string {
  const email = request[OPERATOR_EMAIL_KEY];
  if (email === undefined) {
    // Only reachable if a route skipped the guard; fail closed anyway.
    throw new AuthError("Session is missing or has expired.");
  }
  return email;
}

/**
 * Owner-route session guard: reads the opaque `bos_session` cookie, hashes
 * it, and requires a live (non-revoked, non-expired) session for this
 * deployment's organization. Any failure is the shared 401 shape.
 *
 * Carried note 14: after authenticating, the guard resolves the operator
 * email (session → credential via the credential repository) and attaches
 * it to the request, so controllers pass the real operator identity into
 * use cases for audit events instead of the literal "operator". The
 * deployment is single-operator: exactly one credential must exist, and
 * the guard fails closed if that assumption does not hold.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  private readonly authenticate: AuthenticateSession;
  private readonly credentials: OperatorCredentialRepository;
  private readonly config: ValidatedConfig;

  constructor(
    @Inject(AUTHENTICATE_SESSION) authenticate: AuthenticateSession,
    @Inject(OPERATOR_CREDENTIAL_REPOSITORY)
    credentials: OperatorCredentialRepository,
    @Inject(CONFIG) config: ValidatedConfig,
  ) {
    this.authenticate = authenticate;
    this.credentials = credentials;
    this.config = config;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<OperatorRequest & { headers: Record<string, unknown> }>();
    const sessionToken = readCookie(request.headers, SESSION_COOKIE);
    if (!sessionToken) {
      throw new AuthError(
        "Session is missing or has expired. Please sign in again.",
      );
    }
    await this.authenticate.run(this.config.organization.id, sessionToken);
    const operators = await this.credentials.listByOrganization(
      this.config.organization.id,
    );
    if (operators.length !== 1) {
      throw new AuthError(
        "The operator account for this deployment is not resolvable.",
      );
    }
    request[OPERATOR_EMAIL_KEY] = operators[0].email;
    return true;
  }
}
