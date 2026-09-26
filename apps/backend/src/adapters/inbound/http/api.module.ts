import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { OwnerSeeder } from "../../../infrastructure/composition/owner-seeder";
import { authProviders } from "../../../infrastructure/composition/providers/auth.providers";
import { ingressUseCaseProviders } from "../../../infrastructure/composition/providers/ingress.providers";
import { ownerProviders } from "../../../infrastructure/composition/providers/owner.providers";
import { quotesProviders } from "../../../infrastructure/composition/providers/quotes.providers";
import { runtimeProviders } from "../../../infrastructure/composition/providers/runtime.providers";
import { AiModule } from "../../outbound/ai/ai.module";
import { ConfigModule } from "../../outbound/config-files/config.module";
import { PersistenceModule } from "../../outbound/persistence/persistence.module";
import { AuthController } from "./auth/auth.controller";
import { HealthController } from "./health.controller";
import { IngressController } from "./ingress/ingress.controller";
import { IngressGuard } from "./ingress/ingress.guard";
import { ingressGuardProviders } from "./ingress/ingress.providers";
import { DraftsController } from "./owner/drafts.controller";
import { InboxController } from "./owner/inbox.controller";
import { MessagesController } from "./owner/messages.controller";
import { OutboxController } from "./owner/outbox.controller";
import { SendController } from "./owner/send.controller";
import { PublicQuotesController } from "./public-quotes/public-quotes.controller";
import { ErrorBodyFilter } from "./shared/error-body.filter";
import { SessionGuard } from "./shared/session.guard";

/**
 * HTTP primary adapter. Controllers and guards only; repository bindings
 * live in PersistenceModule and use-case factories live in
 * infrastructure/composition/providers.
 */
@Module({
  imports: [ConfigModule, PersistenceModule, AiModule],
  controllers: [
    HealthController,
    AuthController,
    InboxController,
    IngressController,
    MessagesController,
    DraftsController,
    SendController,
    OutboxController,
    PublicQuotesController,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ErrorBodyFilter },
    ...runtimeProviders,
    ...ingressGuardProviders,
    ...authProviders,
    ...ingressUseCaseProviders,
    ...ownerProviders,
    ...quotesProviders,
    OwnerSeeder,
    SessionGuard,
    IngressGuard,
  ],
})
export class ApiModule {}
