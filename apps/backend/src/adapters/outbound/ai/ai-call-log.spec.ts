import { describe, expect, it } from "vitest";
import { aiErrorFields, sanitizeDetail } from "./ai-call-log";

describe("ai call error logs", () => {
  it("keeps the provider status and name, and drops the email and key", () => {
    const fields = aiErrorFields({
      name: "RetryError",
      message: "retrying sk-proj-secret after <email>secret subject</email>",
      cause: {
        name: "AI_APICallError",
        statusCode: 400,
        message:
          "Invalid schema for response_format. Prompt was:\n<email>body that must not leak</email>\nkey=sk-proj-secret",
      },
    });
    expect(fields).toEqual({
      errorName: "AI_APICallError",
      statusCode: 400,
      detail: "Invalid schema for response_format. Prompt was:",
    });
    expect(JSON.stringify(fields)).not.toContain("sk-proj-secret");
    expect(JSON.stringify(fields)).not.toContain("body that must not leak");
    expect(JSON.stringify(fields)).not.toContain("secret subject");
  });

  it("redacts a key on the first line and truncates a long detail", () => {
    expect(sanitizeDetail("bad key sk-proj-abc and Bearer tok_123")).toBe(
      "bad key [redacted] and Bearer [redacted]",
    );
    expect(sanitizeDetail(`x${"y".repeat(300)}`)).toHaveLength(240);
  });
});
