import { Module } from "@nestjs/common";

/**
 * Binds EmailSenderPort. The demonstrator only records outbox rows;
 * the disabled/recording fake lands in slice 5, a provider adapter in pilot.
 */
@Module({})
export class EmailModule {}
