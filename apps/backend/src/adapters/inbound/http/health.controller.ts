import { Controller, Get } from "@nestjs/common";

@Controller()
export class HealthController {
  @Get("health")
  getHealth(): { status: "ok" } {
    // Deliberately touches no database or config dependency.
    return { status: "ok" };
  }
}
