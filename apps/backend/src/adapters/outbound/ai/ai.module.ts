import { Module } from "@nestjs/common";
import { CLASSIFIER_PORT } from "../../../core/ports/classifier";
import type { KnowledgeBaseRepository } from "../../../core/ports/knowledge-base-repository";
import { KNOWLEDGE_BASE_REPOSITORY } from "../../../core/ports/knowledge-base-repository";
import { ConfigModule } from "../config-files/config.module";
import { FakeClassifier } from "./fake-classifier";

/**
 * Binds ClassifierPort / DrafterPort. The demonstrator uses the
 * deterministic fake only: `AI_ADAPTER` must be `fake` (or unset, which
 * means the same). Any other value fails boot (fails closed); there is no
 * live model client anywhere.
 */
export function assertFakeAdapter(
  adapter: string | undefined,
): asserts adapter is "fake" | undefined {
  if (adapter !== undefined && adapter !== "fake") {
    throw new Error(
      `AI_ADAPTER "${adapter}" is not supported: the demonstrator allows "fake" only.`,
    );
  }
}

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: CLASSIFIER_PORT,
      useFactory: (knowledgeBase: KnowledgeBaseRepository): FakeClassifier => {
        assertFakeAdapter(process.env.AI_ADAPTER);
        return new FakeClassifier(knowledgeBase);
      },
      inject: [KNOWLEDGE_BASE_REPOSITORY],
    },
  ],
  exports: [CLASSIFIER_PORT],
})
export class AiModule {}
