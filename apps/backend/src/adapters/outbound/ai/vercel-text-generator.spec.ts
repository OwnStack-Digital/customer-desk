import { describe, expect, it } from "vitest";
import { VercelStructuredTextGenerator } from "./vercel-text-generator";

describe("VercelStructuredTextGenerator", () => {
  it("builds a gateway model without calling it", () => {
    const generator = new VercelStructuredTextGenerator({
      apiKey: "test-key",
      modelId: "openai/gpt-4.1-mini",
      provider: "gateway",
    });
    const openai = new VercelStructuredTextGenerator({
      apiKey: "sk-proj-test",
      modelId: "openai/gpt-4.1-mini",
      provider: "openai",
    });
    expect(openai).toBeInstanceOf(VercelStructuredTextGenerator);
    expect(generator).toBeInstanceOf(VercelStructuredTextGenerator);
  });
});
