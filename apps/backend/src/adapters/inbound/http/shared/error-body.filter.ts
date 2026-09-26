import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { Catch, HttpException, HttpStatus } from "@nestjs/common";
import type { Response } from "express";
import { AuthError } from "../../../../core/domain/auth";
import {
  ConflictError,
  StaleRevisionError,
  ValidationError,
} from "../../../../core/domain/errors";
import { InboundValidationError } from "../../../../core/domain/messaging";
import { createLogger } from "../../../../infrastructure/logger";

/** Error codes from docs/PLAN.md "Error body". */
const CODE_BY_STATUS: Record<number, string> = {
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "validation",
};

/**
 * Renders every error as `{ "error": { "code", "message" } }`. Core's
 * framework-free AuthError becomes a 401 "unauthorized".
 */
@Catch()
export class ErrorBodyFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof AuthError) {
      response
        .status(HttpStatus.UNAUTHORIZED)
        .json({ error: { code: "unauthorized", message: exception.message } });
      return;
    }
    if (
      exception instanceof InboundValidationError ||
      exception instanceof ValidationError
    ) {
      response.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
        error: { code: "validation", message: exception.message },
      });
      return;
    }
    if (exception instanceof StaleRevisionError) {
      response.status(HttpStatus.CONFLICT).json({
        error: { code: "stale_revision", message: exception.message },
      });
      return;
    }
    if (exception instanceof ConflictError) {
      response.status(HttpStatus.CONFLICT).json({
        error: { code: "conflict", message: exception.message },
      });
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === "string"
          ? body
          : typeof body === "object" &&
              body !== null &&
              typeof (body as { message?: unknown }).message === "string"
            ? (body as { message: string }).message
            : exception.message;
      response.status(status).json({
        error: { code: CODE_BY_STATUS[status] ?? "error", message },
      });
      return;
    }
    createLogger().error("unhandled error", {
      errorType: exception instanceof Error ? exception.name : typeof exception,
    });
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: "internal", message: "Internal server error" },
    });
  }
}
