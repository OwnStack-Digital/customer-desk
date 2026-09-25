import type {
  KnowledgeBase,
  MailboxBinding,
  OrganizationProfile,
  PriceList,
} from "../../../core/domain/config";
import type { KnowledgeBaseRepository } from "../../../core/ports/knowledge-base-repository";
import type { MailboxRepository } from "../../../core/ports/mailbox-repository";
import type { OrganizationProfileRepository } from "../../../core/ports/organization-profile-repository";
import type { PriceListRepository } from "../../../core/ports/price-list-repository";
import type { ValidatedConfig } from "./loader";

export class FileOrganizationProfileRepository
  implements OrganizationProfileRepository
{
  constructor(private readonly config: ValidatedConfig) {}

  getProfile(): OrganizationProfile {
    return this.config.organization;
  }
}

export class FileKnowledgeBaseRepository implements KnowledgeBaseRepository {
  constructor(private readonly config: ValidatedConfig) {}

  getKnowledgeBase(): KnowledgeBase {
    return this.config.knowledgeBase;
  }
}

export class FilePriceListRepository implements PriceListRepository {
  constructor(private readonly config: ValidatedConfig) {}

  getPriceList(): PriceList {
    return this.config.priceList;
  }
}

export class FileMailboxRepository implements MailboxRepository {
  constructor(private readonly config: ValidatedConfig) {}

  getMailbox(id: string): MailboxBinding | undefined {
    return this.config.mailboxes.find((mailbox) => mailbox.id === id);
  }
}
