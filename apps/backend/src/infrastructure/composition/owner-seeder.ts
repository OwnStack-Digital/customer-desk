import { Inject, Injectable } from "@nestjs/common";
import { CONFIG } from "../../adapters/outbound/config-files/config.module";
import type { ValidatedConfig } from "../../adapters/outbound/config-files/loader";
import { SEED_OWNER, type SeedOwner } from "../../core/use-cases/seed-owner";
import { createLogger } from "../logger";

/**
 * Boot-time owner seeding (composition root): creates the owner credential
 * from BOS_OWNER_EMAIL / BOS_OWNER_PASSWORD when the credential table is
 * empty. The password is never logged. Missing env vars on an empty table
 * skip seeding with a warning instead of crashing the boot.
 */
@Injectable()
export class OwnerSeeder {
  private readonly seedOwner: SeedOwner;
  private readonly config: ValidatedConfig;

  constructor(
    @Inject(SEED_OWNER) seedOwner: SeedOwner,
    @Inject(CONFIG) config: ValidatedConfig,
  ) {
    this.seedOwner = seedOwner;
    this.config = config;
  }

  async onApplicationBootstrap(): Promise<void> {
    const result = await this.seedOwner.run(this.config.organization.id, {
      email: process.env.BOS_OWNER_EMAIL,
      password: process.env.BOS_OWNER_PASSWORD,
    });
    const log = createLogger();
    if (result === "seeded") {
      log.info("seeded owner account", {
        email: process.env.BOS_OWNER_EMAIL,
      });
      return;
    }
    if (result === "missing_env") {
      log.warn(
        "no operator credentials and BOS_OWNER_EMAIL/BOS_OWNER_PASSWORD are not set; skipping owner seeding",
      );
    }
  }
}
