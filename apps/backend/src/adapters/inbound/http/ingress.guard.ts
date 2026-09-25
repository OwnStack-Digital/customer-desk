import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import {
  INGRESS_KEY_COMPARER,
  type IngressKeyComparer,
} from "../../outbound/security/ingress-key-comparer";

/**
 * Bearer-key guard for `POST /inbound/emails`: the caller must present
 * `Authorization: Bearer <BOS_INGRESS_KEY>` (constant-time compare in the
 * infrastructure adapter). Bad or missing keys are the shared 401 shape.
 */
@Injectable()
export class IngressGuard implements CanActivate {
  constructor(
    @Inject(INGRESS_KEY_COMPARER) private readonly keys: IngressKeyComparer,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, unknown> }>();
    const header = request.headers.authorization;
    const presented =
      typeof header === "string" && header.startsWith("Bearer ")
        ? header.slice("Bearer ".length)
        : undefined;
    if (!presented || !this.keys.matches(presented)) {
      throw new UnauthorizedException("Ingress key is missing or incorrect.");
    }
    return true;
  }
}