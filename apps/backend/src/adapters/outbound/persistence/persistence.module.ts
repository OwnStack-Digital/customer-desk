import { Module } from "@nestjs/common";
import { createPersistenceClient, PERSISTENCE_CLIENT } from "./client";

@Module({
  providers: [
    {
      provide: PERSISTENCE_CLIENT,
      useFactory: () => createPersistenceClient(),
    },
  ],
  exports: [PERSISTENCE_CLIENT],
})
export class PersistenceModule {}
