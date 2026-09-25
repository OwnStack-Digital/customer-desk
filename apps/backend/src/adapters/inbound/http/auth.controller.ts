import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { LOGIN, type Login } from "../../../core/use-cases/login";
import { LOGOUT, type Logout } from "../../../core/use-cases/logout";
import { CONFIG } from "../../outbound/config-files/config.module";
import type { ValidatedConfig } from "../../outbound/config-files/loader";
import { readCookie, SESSION_COOKIE, sessionCookieOptions } from "./cookies";
import { validationError } from "./http-error";

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

@Controller("auth")
export class AuthController {
  private readonly login: Login;
  private readonly logout: Logout;
  private readonly config: ValidatedConfig;

  constructor(
    @Inject(LOGIN) login: Login,
    @Inject(LOGOUT) logout: Logout,
    @Inject(CONFIG) config: ValidatedConfig,
  ) {
    this.login = login;
    this.logout = logout;
    this.config = config;
  }

  @Post("login")
  @HttpCode(200)
  async postLogin(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ operator: { email: string } }> {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError("email and password are required");
    }
    const result = await this.login.run(
      this.config.organization.id,
      parsed.data.email,
      parsed.data.password,
    );
    response.cookie(
      SESSION_COOKIE,
      result.sessionToken,
      sessionCookieOptions(),
    );
    return { operator: result.operator };
  }

  @Post("logout")
  @HttpCode(200)
  async postLogout(
    @Headers() headers: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, never>> {
    const sessionToken = readCookie(headers, SESSION_COOKIE);
    if (sessionToken) {
      // Idempotent: missing, expired, and revoked sessions are fine.
      await this.logout.run(this.config.organization.id, sessionToken);
    }
    response.clearCookie(SESSION_COOKIE, sessionCookieOptions());
    return {};
  }
}
