/**
 * Which classifier/drafter pair `AiModule` binds. `fake` is the default and
 * makes no network call. `vercel` is the Vercel AI SDK adapter. An OpenAI
 * key (`sk-…`, or `OPENAI_API_KEY`) uses the SDK's OpenAI provider. Any
 * other key uses the Vercel AI Gateway. Anything else fails boot.
 */

export type AiAdapterEnv = {
  readonly AI_ADAPTER?: string;
  readonly AI_MODEL?: string;
  readonly AI_GATEWAY_API_KEY?: string;
  readonly OPENAI_API_KEY?: string;
  readonly AI_TIMEOUT_MS?: string;
};

export type AiProvider = "gateway" | "openai";

export type AiAdapterSelection =
  | { readonly kind: "fake" }
  | {
      readonly kind: "vercel";
      readonly provider: AiProvider;
      readonly modelId: string;
      readonly apiKey: string;
      readonly timeoutMs: number;
    };

const DEFAULT_TIMEOUT_MS = 20_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;

/** Gateway ids are `creator/model`, lowercase, no spaces. */
const MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/;

export function selectAiAdapter(env: AiAdapterEnv): AiAdapterSelection {
  const adapter = env.AI_ADAPTER?.trim() || "fake";
  if (adapter === "fake") {
    return { kind: "fake" };
  }
  if (adapter !== "vercel") {
    throw new Error(
      `AI_ADAPTER "${adapter}" is not supported: use "fake" or "vercel".`,
    );
  }
  const modelId = env.AI_MODEL?.trim() ?? "";
  const credential = resolveCredential(env);
  assertModelId(credential.provider, modelId);
  return {
    kind: "vercel",
    provider: credential.provider,
    modelId,
    apiKey: credential.apiKey,
    timeoutMs: parseTimeout(env.AI_TIMEOUT_MS),
  };
}

/** OpenAI platform keys are not AI Gateway keys. `sk-proj-` starts with `sk-`. */
function isOpenAiKey(key: string): boolean {
  return key.startsWith("sk-");
}

function resolveCredential(env: AiAdapterEnv): {
  provider: AiProvider;
  apiKey: string;
} {
  const gatewayKey = env.AI_GATEWAY_API_KEY?.trim() ?? "";
  const openaiKey = env.OPENAI_API_KEY?.trim() ?? "";
  if (openaiKey !== "" && gatewayKey !== "" && !isOpenAiKey(gatewayKey)) {
    throw new Error(
      'AI_ADAPTER "vercel" accepts OPENAI_API_KEY or AI_GATEWAY_API_KEY, not both.',
    );
  }
  const apiKey = openaiKey || gatewayKey;
  if (apiKey === "") {
    throw new Error(
      'AI_ADAPTER "vercel" requires OPENAI_API_KEY or AI_GATEWAY_API_KEY. Refusing to boot without one.',
    );
  }
  if (openaiKey !== "" || isOpenAiKey(apiKey)) {
    return { provider: "openai", apiKey };
  }
  return { provider: "gateway", apiKey };
}

function assertModelId(provider: AiProvider, modelId: string): void {
  if (provider === "openai") {
    const name = modelId.startsWith("openai/")
      ? modelId.slice("openai/".length)
      : modelId;
    if (modelId.includes("/") && !modelId.startsWith("openai/")) {
      throw new Error(
        `AI_MODEL "${modelId}" cannot be called with an OpenAI API key. Use openai/<model>, or use an AI Gateway key.`,
      );
    }
    if (!/^[a-z0-9][a-z0-9._:-]*$/.test(name)) {
      throw new Error(
        'AI_ADAPTER "vercel" requires AI_MODEL such as openai/gpt-4.1-mini when using an OpenAI API key.',
      );
    }
    return;
  }
  if (!MODEL_ID.test(modelId)) {
    throw new Error(
      'AI_ADAPTER "vercel" requires AI_MODEL set to a Gateway model id such as openai/gpt-4.1-mini.',
    );
  }
}

function parseTimeout(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_TIMEOUT_MS;
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("AI_TIMEOUT_MS must be a whole number of milliseconds.");
  }
  const value = Number(trimmed);
  if (value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new Error(
      `AI_TIMEOUT_MS must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}.`,
    );
  }
  return value;
}
