import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Inject, Injectable } from "@nestjs/common";
import { AuthError } from "../../../core/domain/auth";
import {
  AUTHENTICATE_SESSION,
  type AuthenticateSession,
} from "../../../core/use-cases/authenticate-session";
import { CONFIG } from "../../outbound/config-files/config.module";
import type { ValidatedConfig } from "../../outbound/config-files/loader";
import { readCookie, SESSION_COOKIE } from "./cookies";

/**
 * Owner-route session guard: reads the opaque `bos_session` cookie, hashes
 * it, and requires a live (non-revoked, non-expired) session for this
 * deployment's organization. Any failure is the shared 401 shape.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  private readonly authenticate: AuthenticateSession;
  private readonly config: ValidatedConfig;

  constructor(
    @Inject(AUTHENTICATE_SESSION) authenticate: AuthenticateSession,
    @Inject(CONFIG) config: ValidatedConfig,
  ) {
    this.authenticate = authenticate;
    this.config = config;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, unknown> }>();
    const sessionToken = readCookie(request.headers, SESSION_COOKIE);
    if (!sessionToken) {
      throw new AuthError(
        "Session is missing or has expired. Please sign in again.",
      );
    }
    await this.authenticate.run(this.config.organization.id, sessionToken);
    return true;
  }
}
