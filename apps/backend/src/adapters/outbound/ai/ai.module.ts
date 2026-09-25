import { Module } from "@nestjs/common";

/**
 * Binds ClassifierPort / DrafterPort. The demonstrator uses the
 * deterministic fake (AI_ADAPTER=fake), which lands in slice 3.
 */
@Module({})
export class AiModule {}
