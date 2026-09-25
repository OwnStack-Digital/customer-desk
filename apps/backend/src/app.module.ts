import { Module } from "@nestjs/common";
import { ApiModule } from "./adapters/inbound/http/api.module";
import { AiModule } from "./adapters/outbound/ai/ai.module";
import { ConfigModule } from "./adapters/outbound/config-files/config.module";
import { EmailModule } from "./adapters/outbound/email/email.module";
import { PersistenceModule } from "./adapters/outbound/persistence/persistence.module";

@Module({
  imports: [ConfigModule, PersistenceModule, AiModule, EmailModule, ApiModule],
})
export class AppModule {}
