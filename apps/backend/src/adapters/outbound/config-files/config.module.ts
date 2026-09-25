import { Module } from "@nestjs/common";
import { KNOWLEDGE_BASE_REPOSITORY } from "../../../core/ports/knowledge-base-repository";
import { MAILBOX_REPOSITORY } from "../../../core/ports/mailbox-repository";
import { ORGANIZATION_PROFILE_REPOSITORY } from "../../../core/ports/organization-profile-repository";
import { PRICE_LIST_REPOSITORY } from "../../../core/ports/price-list-repository";
import {
  FileKnowledgeBaseRepository,
  FileMailboxRepository,
  FileOrganizationProfileRepository,
  FilePriceListRepository,
} from "./file-repositories";
import { loadConfig, type ValidatedConfig } from "./loader";

/** DI token holding the validated, frozen configuration loaded at boot. */
export const CONFIG = "BOS_VALIDATED_CONFIG";

/**
 * Loads and validates all four config files at boot. An invalid or missing
 * file makes the useFactory throw, which fails boot (fails closed).
 */
@Module({
  providers: [
    {
      provide: CONFIG,
      useFactory: (): ValidatedConfig => loadConfig(),
    },
    {
      provide: ORGANIZATION_PROFILE_REPOSITORY,
      useFactory: (config: ValidatedConfig) =>
        new FileOrganizationProfileRepository(config),
      inject: [CONFIG],
    },
    {
      provide: KNOWLEDGE_BASE_REPOSITORY,
      useFactory: (config: ValidatedConfig) =>
        new FileKnowledgeBaseRepository(config),
      inject: [CONFIG],
    },
    {
      provide: PRICE_LIST_REPOSITORY,
      useFactory: (config: ValidatedConfig) =>
        new FilePriceListRepository(config),
      inject: [CONFIG],
    },
    {
      provide: MAILBOX_REPOSITORY,
      useFactory: (config: ValidatedConfig) =>
        new FileMailboxRepository(config),
      inject: [CONFIG],
    },
  ],
  exports: [
    ORGANIZATION_PROFILE_REPOSITORY,
    KNOWLEDGE_BASE_REPOSITORY,
    PRICE_LIST_REPOSITORY,
    MAILBOX_REPOSITORY,
  ],
})
export class ConfigModule {}
