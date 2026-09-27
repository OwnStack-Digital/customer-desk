import { describe, expect, it } from "vitest";
import { selectAiAdapter } from "./ai-adapter-config";

describe("AI_ADAPTER boot selection", () => {
  it("defaults blank and unset to the fake adapter", () => {
    expect(selectAiAdapter({})).toEqual({ kind: "fake" });
    expect(selectAiAdapter({ AI_ADAPTER: "fake" })).toEqual({ kind: "fake" });
    expect(selectAiAdapter({ AI_ADAPTER: "  " })).toEqual({ kind: "fake" });
  });

  it("fails closed on an unknown adapter", () => {
    expect(() => selectAiAdapter({ AI_ADAPTER: "openai" })).toThrow(
      /use "fake" or "vercel"/,
    );
    expect(() => selectAiAdapter({ AI_ADAPTER: "live" })).toThrow(
      /use "fake" or "vercel"/,
    );
  });

  it("requires a gateway model id and key for vercel, and does not echo the key", () => {
    expect(() =>
      selectAiAdapter({ AI_ADAPTER: "vercel", AI_GATEWAY_API_KEY: "secret" }),
    ).toThrow(/AI_MODEL/);
    expect(() =>
      selectAiAdapter({
        AI_ADAPTER: "vercel",
        AI_MODEL: "gpt-4.1-mini",
        AI_GATEWAY_API_KEY: "secret",
      }),
    ).toThrow(/Gateway model id/);
    expect(() =>
      selectAiAdapter({
        AI_ADAPTER: "vercel",
        AI_MODEL: "openai/gpt-4.1-mini",
      }),
    ).toThrow(/AI_GATEWAY_API_KEY/);

    const selected = selectAiAdapter({
      AI_ADAPTER: "vercel",
      AI_MODEL: "openai/gpt-4.1-mini",
      AI_GATEWAY_API_KEY: "secret-key",
    });
    expect(selected).toEqual({
      kind: "vercel",
      provider: "gateway",
      modelId: "openai/gpt-4.1-mini",
      apiKey: "secret-key",
      timeoutMs: 20_000,
    });
    expect(() =>
      selectAiAdapter({
        AI_ADAPTER: "vercel",
        AI_MODEL: "not a model",
        AI_GATEWAY_API_KEY: "secret-key",
      }),
    ).toThrow(/Gateway model id/);
    try {
      selectAiAdapter({
        AI_ADAPTER: "vercel",
        AI_MODEL: "not a model",
        AI_GATEWAY_API_KEY: "secret-key",
      });
    } catch (error) {
      expect((error as Error).message).not.toContain("secret-key");
    }
  });

  it("rejects a timeout outside 1s–120s and accepts an explicit one", () => {
    const env = {
      AI_ADAPTER: "vercel",
      AI_MODEL: "openai/gpt-4.1-mini",
      AI_GATEWAY_API_KEY: "secret-key",
    };
    expect(() => selectAiAdapter({ ...env, AI_TIMEOUT_MS: "nope" })).toThrow(
      /whole number/,
    );
    expect(() => selectAiAdapter({ ...env, AI_TIMEOUT_MS: "500" })).toThrow(
      /between 1000 and 120000/,
    );
    expect(selectAiAdapter({ ...env, AI_TIMEOUT_MS: "15000" })).toMatchObject({
      timeoutMs: 15_000,
    });
  });

  it("routes an OpenAI key to the OpenAI provider and does not echo it", () => {
    expect(
      selectAiAdapter({
        AI_ADAPTER: "vercel",
        AI_MODEL: "openai/gpt-4.1-mini",
        AI_GATEWAY_API_KEY: "sk-proj-example",
      }),
    ).toEqual({
      kind: "vercel",
      provider: "openai",
      modelId: "openai/gpt-4.1-mini",
      apiKey: "sk-proj-example",
      timeoutMs: 20_000,
    });
    const openai = selectAiAdapter({
      AI_ADAPTER: "vercel",
      AI_MODEL: "gpt-4.1-mini",
      OPENAI_API_KEY: "sk-proj-other",
    });
    expect(openai.kind === "vercel" && openai.provider).toBe("openai");
    expect(() =>
      selectAiAdapter({
        AI_ADAPTER: "vercel",
        AI_MODEL: "anthropic/claude-sonnet-4.5",
        AI_GATEWAY_API_KEY: "sk-proj-example",
      }),
    ).toThrow(/OpenAI API key/);
    try {
      selectAiAdapter({
        AI_ADAPTER: "vercel",
        AI_MODEL: "not a model",
        OPENAI_API_KEY: "sk-proj-example",
      });
    } catch (error) {
      expect((error as Error).message).not.toContain("sk-proj-example");
    }
  });
});
