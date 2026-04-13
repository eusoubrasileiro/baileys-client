import { describe, expect, it } from "vitest";
import pino from "pino";

// Contract tests pinning the pino API consumed by baileys-client.
// Must stay green across pino 9 → 10.

type CapturedLine = {
  level: number;
  msg: string;
  [k: string]: unknown;
};

function makeCapturingLogger(level = "info") {
  const lines: CapturedLine[] = [];
  const stream = {
    write(chunk: string) {
      for (const line of chunk.split("\n")) {
        if (!line) continue;
        lines.push(JSON.parse(line));
      }
    },
  };
  const logger = pino({ level }, stream);
  return { logger, lines };
}

describe("pino logger contract (baileys-client)", () => {
  it("pino default export is a factory function", () => {
    expect(typeof pino).toBe("function");
  });

  it("Logger type has .info/.warn/.error/.debug methods", () => {
    const { logger } = makeCapturingLogger();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("emits JSON lines with a level field", () => {
    const { logger, lines } = makeCapturingLogger();
    logger.info("hi");
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe(30);
    expect(lines[0].msg).toBe("hi");
  });

  it("accepts {err} binding used by error paths", () => {
    const { logger, lines } = makeCapturingLogger();
    logger.error({ err: new Error("boom") }, "Failed to sync");
    expect(lines[0].msg).toBe("Failed to sync");
    expect(lines[0].err).toBeDefined();
  });

  it("creates child loggers that inherit level and emit", () => {
    const { logger, lines } = makeCapturingLogger();
    const child = logger.child({ component: "sender" });
    child.info("sent");
    expect(lines[0].msg).toBe("sent");
    expect(lines[0].component).toBe("sender");
  });
});
