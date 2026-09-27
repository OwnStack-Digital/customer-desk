import { createOpenAI } from "@ai-sdk/openai";
import { createGateway, generateText, Output } from "ai";
import type { StructuredLogger } from "../../../infrastructure/logger";
import { createLogger } from "../../../infrastructure/logger";
import type { AiProvider } from "./ai-adapter-config";
import { aiErrorFields } from "./ai-call-log";
import type {
  StructuredGenerateRequest,
  StructuredTextGenerator,
} from "./structured-text-generator";

/**
 * Vercel AI SDK call. OpenAI keys use `@ai-sdk/openai`. Other keys use the
 * AI Gateway. The Nest build emits CommonJS; Node 24 can load these ESM
 * packages. The API key and the prompt are never written to a log from here.
 */
export class VercelStructuredTextGenerator implements StructuredTextGenerator {
  private readonly model: ReturnType<ReturnType<typeof createGateway>>;
  private readonly provider: AiProvider;
  private readonly modelId: string;
  private readonly logger: StructuredLogger;

  constructor(options: {
    readonly apiKey: string;
    readonly modelId: string;
    readonly provider: AiProvider;
    readonly logger?: StructuredLogger;
  }) {
    this.provider = options.provider;
    this.modelId = options.modelId;
    this.logger = options.logger ?? createLogger();
    this.model = modelFor(options);
  }

  async generate(request: StructuredGenerateRequest): Promise<unknown> {
    const started = Date.now();
    const fields = {
      operation: request.operation,
      provider: this.provider,
      model: this.modelId,
      timeoutMs: request.timeoutMs,
      promptChars: request.prompt.length,
    };
    try {
      const { output } = await generateText({
        model: this.model,
        system: request.system,
        prompt: request.prompt,
        output: Output.object({ schema: request.schema }),
        timeout: request.timeoutMs,
        maxOutputTokens: request.maxOutputTokens,
        // One retry for a transient gateway error, still bounded by timeout.
        maxRetries: 1,
      });
      this.logger.info("ai call completed", {
        ...fields,
        durationMs: Date.now() - started,
      });
      return output;
    } catch (error) {
      this.logger.error("ai call failed", {
        ...fields,
        durationMs: Date.now() - started,
        ...aiErrorFields(error),
      });
      throw error;
    }
  }
}

function modelFor(options: {
  readonly apiKey: string;
  readonly modelId: string;
  readonly provider: AiProvider;
}): ReturnType<ReturnType<typeof createGateway>> {
  if (options.provider === "openai") {
    const name = options.modelId.startsWith("openai/")
      ? options.modelId.slice("openai/".length)
      : options.modelId;
    return createOpenAI({ apiKey: options.apiKey })(name);
  }
  return createGateway({ apiKey: options.apiKey })(options.modelId);
}
