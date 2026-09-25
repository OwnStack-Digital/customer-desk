import { describe, expect, it } from "vitest";
import { assertFakeAdapter } from "./ai.module";

describe("AI_ADAPTER boot guard", () => {
  it("accepts fake and unset, fails closed on anything else", () => {
    expect(() => assertFakeAdapter(undefined)).not.toThrow();
    expect(() => assertFakeAdapter("fake")).not.toThrow();
    expect(() => assertFakeAdapter("live")).toThrow(/allows "fake" only/);
    expect(() => assertFakeAdapter("openai")).toThrow(/allows "fake" only/);
  });
});
