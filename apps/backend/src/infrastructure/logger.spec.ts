import { describe, expect, it } from "vitest";
import { createLogger } from "./logger";

function makeSink(): { lines: string[]; sink: (line: string) => void } {
  const lines: string[] = [];
  return { lines, sink: (line) => lines.push(line) };
}

describe("structured logger", () => {
  it("writes one JSON line per entry with level and msg", () => {
    const { lines, sink } = makeSink();
    createLogger(sink).info("backend listening", { port: 3001 });

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(record.level).toBe("info");
    expect(record.msg).toBe("backend listening");
    expect(record.port).toBe(3001);
  });

  it("never emits values of redacted keys, at any depth or case", () => {
    const { lines, sink } = makeSink();
    createLogger(sink).info("inbound email received", {
      authorization: "Bearer sekrit",
      Password: "hunter2",
      cookie: "bos_session=cookie-secret",
      "Set-Cookie": "bos_session=cookie-secret-2",
      token: "tok-123",
      text: "raw email text secret",
      html: "<p>html secret</p>",
      body: "raw email body secret",
      nested: { token: "nested-tok", safe: "nested-safe-value" },
      attachments: [{ name: "invoice.pdf", body: "attachment secret" }],
      subject: "visible subject",
    });
    const output = lines.join("\n");

    const secrets = [
      "sekrit",
      "hunter2",
      "cookie-secret",
      "tok-123",
      "nested-tok",
      "raw email text secret",
      "html secret",
      "raw email body secret",
      "attachment secret",
    ];
    for (const secret of secrets) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain("[redacted]");
    expect(output).toContain("visible subject");
    expect(output).toContain("nested-safe-value");
  });

  it("redacts across all log levels", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger(sink);
    logger.debug("m", { password: "p1" });
    logger.info("m", { password: "p2" });
    logger.warn("m", { password: "p3" });
    logger.error("m", { password: "p4" });
    const output = lines.join("\n");

    expect(output).not.toContain("p1");
    expect(output).not.toContain("p2");
    expect(output).not.toContain("p3");
    expect(output).not.toContain("p4");
    expect(lines).toHaveLength(4);
  });
});
