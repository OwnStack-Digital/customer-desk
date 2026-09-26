import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import {
  loadDotEnvIfPresent,
  rootsFromBackendEntry,
} from "./infrastructure/env-file";
import { createLogger } from "./infrastructure/logger";

async function bootstrap(): Promise<void> {
  loadDotEnvIfPresent(rootsFromBackendEntry(__dirname));
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  createLogger().info("backend listening", { port });
}

void bootstrap();
