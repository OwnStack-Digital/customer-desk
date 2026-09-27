import type { z } from "zod";

/**
 * The only thing the classifier and drafter need from a model client.
 * Tests inject a scripted implementation; the Vercel adapter is the
 * production one. The schema is guidance for the model — callers still
 * parse and discard anything that is not a legal slot.
 */
export type AiCallOperation = "classify" | "draft";

export interface StructuredGenerateRequest {
  readonly operation: AiCallOperation;
  readonly system: string;
  readonly prompt: string;
  readonly schema: z.ZodType;
  readonly timeoutMs: number;
  /** Caps the completion so a rambling model cannot blow the timeout. */
  readonly maxOutputTokens: number;
}

export interface StructuredTextGenerator {
  generate(request: StructuredGenerateRequest): Promise<unknown>;
}
