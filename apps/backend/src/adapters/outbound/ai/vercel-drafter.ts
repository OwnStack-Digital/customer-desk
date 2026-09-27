import { z } from "zod";
import {
  cleanWording,
  type DrafterWording,
} from "../../../core/domain/drafting";
import type { DrafterPort } from "../../../core/ports/drafter";
import type { OrganizationProfileRepository } from "../../../core/ports/organization-profile-repository";
import { FAKE_DRAFTER_WORDING } from "./fake-drafter";
import type { StructuredTextGenerator } from "./structured-text-generator";

/**
 * Live drafter. The port takes no email, so this can only produce a
 * business-level greeting and closing — never facts, prices, or a promise.
 * Unsafe wording is dropped by the domain rule and replaced with the fake
 * constant. A model failure does the same: wording is optional, and a
 * wording outage must not fail an already-classified draft.
 */

const wordingSchema = z.object({
  greeting: z.string().nullish(),
  closing: z.string().nullish(),
});

/** OpenAI strict response_format requires every property. */
const strictWordingSchema = z.object({
  greeting: z.string().nullable(),
  closing: z.string().nullable(),
});

const SYSTEM = [
  "Write a short email greeting and a short sign-off for a small service business.",
  "Return only those two strings.",
  "Do not include facts, prices, dates, quantities, guarantees, bookings, payment, fault, or apologies.",
  "No digits. No currency symbols.",
  "Both fields are required. Use null if you have nothing safe to say.",
].join(" ");

export class VercelDrafter implements DrafterPort {
  private cached: DrafterWording | undefined;

  constructor(
    private readonly profile: OrganizationProfileRepository,
    private readonly generator: StructuredTextGenerator,
    private readonly timeoutMs: number,
  ) {}

  async draft(): Promise<DrafterWording> {
    if (this.cached) {
      return this.cached;
    }
    try {
      const raw = await this.generator.generate({
        operation: "draft",
        system: SYSTEM,
        prompt: `Business name: ${this.profile.getProfile().name}`,
        schema: strictWordingSchema,
        timeoutMs: this.timeoutMs,
        maxOutputTokens: 80,
      });
      const parsed = wordingSchema.safeParse(raw);
      if (!parsed.success) {
        return FAKE_DRAFTER_WORDING;
      }
      const wording: DrafterWording = {
        greeting:
          cleanWording(parsed.data.greeting ?? undefined) ??
          FAKE_DRAFTER_WORDING.greeting,
        closing:
          cleanWording(parsed.data.closing ?? undefined) ??
          FAKE_DRAFTER_WORDING.closing,
      };
      this.cached = wording;
      return wording;
    } catch {
      return FAKE_DRAFTER_WORDING;
    }
  }
}
