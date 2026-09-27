import { Module } from "@nestjs/common";
import { CLASSIFIER_PORT } from "../../../core/ports/classifier";
import { DRAFTER_PORT } from "../../../core/ports/drafter";
import type { KnowledgeBaseRepository } from "../../../core/ports/knowledge-base-repository";
import { KNOWLEDGE_BASE_REPOSITORY } from "../../../core/ports/knowledge-base-repository";
import type { OrganizationProfileRepository } from "../../../core/ports/organization-profile-repository";
import { ORGANIZATION_PROFILE_REPOSITORY } from "../../../core/ports/organization-profile-repository";
import type { PriceListRepository } from "../../../core/ports/price-list-repository";
import { PRICE_LIST_REPOSITORY } from "../../../core/ports/price-list-repository";
import { createLogger } from "../../../infrastructure/logger";
import { ConfigModule } from "../config-files/config.module";
import { selectAiAdapter } from "./ai-adapter-config";
import { FakeClassifier } from "./fake-classifier";
import { FakeDrafter } from "./fake-drafter";
import { VercelClassifier } from "./vercel-classifier";
import { VercelDrafter } from "./vercel-drafter";
import { VercelStructuredTextGenerator } from "./vercel-text-generator";

/**
 * Binds ClassifierPort / DrafterPort.
 *
 * `AI_ADAPTER=fake` (or unset) is the deterministic fake and the default.
 * `AI_ADAPTER=vercel` binds the Vercel AI SDK adapters. Anything else, or a
 * vercel selection missing its model id or gateway key, fails boot.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: CLASSIFIER_PORT,
      useFactory: (
        knowledgeBase: KnowledgeBaseRepository,
        priceList: PriceListRepository,
        profile: OrganizationProfileRepository,
      ) => {
        const selection = selectAiAdapter(process.env);
        if (selection.kind === "fake") {
          return new FakeClassifier(knowledgeBase, priceList);
        }
        createLogger().info("ai adapter bound", {
          adapter: "vercel",
          provider: selection.provider,
          model: selection.modelId,
        });
        return new VercelClassifier(
          knowledgeBase,
          priceList,
          profile,
          new VercelStructuredTextGenerator(selection),
          selection.timeoutMs,
        );
      },
      inject: [
        KNOWLEDGE_BASE_REPOSITORY,
        PRICE_LIST_REPOSITORY,
        ORGANIZATION_PROFILE_REPOSITORY,
      ],
    },
    {
      provide: DRAFTER_PORT,
      useFactory: (profile: OrganizationProfileRepository) => {
        const selection = selectAiAdapter(process.env);
        if (selection.kind === "fake") {
          return new FakeDrafter();
        }
        return new VercelDrafter(
          profile,
          new VercelStructuredTextGenerator(selection),
          selection.timeoutMs,
        );
      },
      inject: [ORGANIZATION_PROFILE_REPOSITORY],
    },
  ],
  exports: [CLASSIFIER_PORT, DRAFTER_PORT],
})
export class AiModule {}
