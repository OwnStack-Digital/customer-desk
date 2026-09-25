/** Application clock. Tests inject a fixed implementation. */
export interface Clock {
  now(): Date;
}

export const CLOCK = "Clock";
