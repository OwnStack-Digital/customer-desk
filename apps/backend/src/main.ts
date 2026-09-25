import "reflect-metadata";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { createLogger } from "./infrastructure/logger";

function loadDotEnvIfPresent(): void {
  const candidates = [
    resolve(__dirname, "../.env"), // apps/backend/.env
    resolve(__dirname, "../../../.env"), // repo root .env
    resolve(process.cwd(), ".env"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
  }
}

async function bootstrap(): Promise<void> {
  loadDotEnvIfPresent();
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  createLogger().info("backend listening", { port });
}

void bootstrap();
