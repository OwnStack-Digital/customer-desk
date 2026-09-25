import type { DrafterWording } from "../../../core/domain/drafting";
import type { DrafterPort } from "../../../core/ports/drafter";

/**
 * Deterministic fake drafter: trivial, constant wording only
 * (docs/PLAN.md `AI_ADAPTER=fake`). It physically cannot add facts — its
 * return type has greeting/closing only. Violating wording is dropped by
 * the renderer's drop rule, tested there directly.
 */
export const FAKE_DRAFTER_WORDING: DrafterWording = {
  greeting: "Hi,",
  closing: "Thanks,",
};

export class FakeDrafter implements DrafterPort {
  async draft(): Promise<DrafterWording> {
    return FAKE_DRAFTER_WORDING;
  }
}
