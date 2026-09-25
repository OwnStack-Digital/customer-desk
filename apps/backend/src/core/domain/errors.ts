/**
 * Framework-free error types with a stable `code` per docs/PLAN.md
 * "Error body". The HTTP exception filter maps these to their status and
 * code; use cases and tests stay free of Nest imports.
 */

/** 409 `stale_revision`: the action targets an outdated draft revision. */
export class StaleRevisionError extends Error {
  readonly code = "stale_revision";

  constructor(
    message = "The draft revision is stale; approve or edit the latest one.",
  ) {
    super(message);
    this.name = "StaleRevisionError";
  }
}

/** 409 `conflict`: the request conflicts with stored state (PLAN.md table). */
export class ConflictError extends Error {
  readonly code = "conflict";

  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}