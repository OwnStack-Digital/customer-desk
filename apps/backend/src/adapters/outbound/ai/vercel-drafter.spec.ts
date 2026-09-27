import { describe, expect, it } from "vitest";
import type { OrganizationProfile } from "../../../core/domain/config";
import { FAKE_DRAFTER_WORDING } from "./fake-drafter";
import type { StructuredTextGenerator } from "./structured-text-generator";
import { VercelDrafter } from "./vercel-drafter";

const PROFILE: OrganizationProfile = {
  id: "org",
  name: "Harbour & Pine Cleaning",
  timezone: "Australia/Sydney",
  currency: "AUD",
  fromAddress: "hello@example.com",
  quoteValidityDays: 14,
  taxMode: "none",
  mailboxId: "mbx",
};

describe("VercelDrafter", () => {
  it("drops unsafe wording, caches a safe result, and never sends an email", async () => {
    let calls = 0;
    const generator: StructuredTextGenerator = {
      async generate(request) {
        calls += 1;
        expect(request.prompt).not.toContain("customer");
        expect(request.system).toContain("No digits");
        expect(request.prompt).toContain("Harbour & Pine Cleaning");
        return {
          greeting: "Hi there,",
          closing: "Total is $40, sorry we failed",
        };
      },
    };
    const drafter = new VercelDrafter(
      { getProfile: () => PROFILE },
      generator,
      5_000,
    );
    const first = await drafter.draft();
    const second = await drafter.draft();
    expect(first).toEqual({
      greeting: "Hi there,",
      closing: FAKE_DRAFTER_WORDING.closing,
    });
    expect(second).toEqual(first);
    expect(calls).toBe(1);
  });

  it("falls back to the constant wording when the model call fails, and retries later", async () => {
    let calls = 0;
    const generator: StructuredTextGenerator = {
      async generate() {
        calls += 1;
        if (calls === 1) {
          throw new Error("timeout while drafting a $40 apology");
        }
        return { greeting: "Hello,", closing: "Kind regards," };
      },
    };
    const drafter = new VercelDrafter(
      { getProfile: () => PROFILE },
      generator,
      5_000,
    );
    expect(await drafter.draft()).toEqual(FAKE_DRAFTER_WORDING);
    expect(await drafter.draft()).toEqual({
      greeting: "Hello,",
      closing: "Kind regards,",
    });
    expect(calls).toBe(2);
  });
});
