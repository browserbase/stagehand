import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StagehandFacadeConfigError } from "../src/facade/config.js";
import { createFacadeLogger, redactToolLog } from "../src/facade/logging.js";

describe("facade tool logging", () => {
  it("redacts credentials, excludes images and bounds large records", () => {
    const result = JSON.stringify(
      redactToolLog({
        password: "private",
        authorization: "secret",
        code: 'const token="sensitive";',
        data: "a".repeat(1000),
      }),
    );
    expect(result).not.toContain("private");
    expect(result).not.toContain("sensitive");
    expect(result).toContain("binary omitted");
    expect(redactToolLog({ code: "x".repeat(1000) }, 256)).toMatchObject({ truncated: true });
  });

  it.each([{ STAGEHAND_FACADE_LOG_LEVEL: "verbose" }, { STAGEHAND_FACADE_LOG_MAX_CHARS: "255" }])(
    "rejects invalid logging configuration with a typed error",
    (env) => {
      expect(() => createFacadeLogger(env)).toThrow(StagehandFacadeConfigError);
    },
  );

  it.each(["debug", "calls"])(
    "omits short image data from %s result records before truncation",
    async (level) => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), "facade-image-log-"));
      const file = path.join(directory, "calls.jsonl");
      const logger = createFacadeLogger({
        STAGEHAND_FACADE_LOG_FILE: file,
        STAGEHAND_FACADE_LOG_LEVEL: level,
      });
      try {
        for (const size of [4, 256, 257]) {
          const data = "A".repeat(size);
          await logger.call(String(size), "screenshot", {}, async () => ({
            isError: level === "calls",
            content: [{ type: "image", mimeType: "image/png", data }],
          }));
          const redacted = JSON.stringify(
            redactToolLog({ content: [{ type: "image", data }], tail: "x".repeat(400) }, 256),
          );
          expect(redacted).not.toContain(data);
        }
        const records = (await fs.readFile(file, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        for (const record of records.filter((record) => record.event === "tool.end")) {
          expect(record.result.content[0].data).toMatch(/^\[binary omitted:/);
        }
      } finally {
        logger.close();
        await fs.rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("pairs call IDs with code, status and timing without using stdout", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "facade-log-test-"));
    const file = path.join(directory, "calls.jsonl");
    const logger = createFacadeLogger({
      STAGEHAND_FACADE_LOG_FILE: file,
      STAGEHAND_FACADE_LOG_LEVEL: "debug",
    });
    try {
      await logger.call("42", "run", { code: "return 1" }, async () => ({
        content: [{ type: "text", text: "1" }],
      }));
      await logger.call("43", "snapshot", {}, async () => ({
        isError: true,
        content: [{ type: "text", text: "unavailable" }],
      }));
      const records = (await fs.readFile(file, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(records[0]).toMatchObject({
        event: "tool.start",
        id: "42",
        arguments: { code: "return 1" },
      });
      expect(records[1]).toMatchObject({
        event: "tool.end",
        id: "42",
        status: "ok",
        durationMs: expect.any(Number),
      });
      expect(records[3]).toMatchObject({ id: "43", status: "error" });
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    } finally {
      logger.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
