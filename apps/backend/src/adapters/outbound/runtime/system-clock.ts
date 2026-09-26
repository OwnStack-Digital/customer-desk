import type { Clock } from "../../../core/ports/clock";

/** Real wall-clock time. Tests inject a deterministic fake instead. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
