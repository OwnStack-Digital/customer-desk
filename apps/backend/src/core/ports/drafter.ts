import type { DrafterWording } from "../domain/drafting";

/**
 * DrafterPort (docs/PLAN.md "Classifier and drafter ports"): optional
 * non-binding wording only. The use case builds the customer-visible body;
 * the drafter can never add facts to a draft.
 */
export interface DrafterPort {
  draft(): Promise<DrafterWording>;
}

/** DI token (composition root only; the use case itself is framework-free). */
export const DRAFTER_PORT = "DrafterPort";
