import { trace } from "@opentelemetry/api";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { StagehandLog } from "../../protocol/types.js";
import { performUnderstudyMethod } from "../handlers/handlerUtils/actHandlerUtils.js";
import { StagehandLogger } from "../logger.js";
import type { StagehandTracing } from "../tracing.js";
import type { Frame } from "../understudy/frame.js";
import type { Page } from "../understudy/page.js";

const PACKAGES_ROOT = path.resolve(import.meta.dirname, "../..");

describe("Stagehand legacy logging migration", () => {
  it("does not call the legacy V3 logger anywhere in the extension", async () => {
    expect(await findExtensionSourceMatches(/\bv3Logger\b/)).toEqual([]);
  });

  it("does not call FlowLogger anywhere in the extension", async () => {
    expect(await findExtensionSourceMatches(/\bFlowLogger\b/)).toEqual([]);
  });

  it("does not expose the legacy LogLine schema or type", async () => {
    expect(await findSourceMatches(/\bLogLine(?:Schema)?\b/, ["protocol", "extension"])).toEqual(
      [],
    );
  });

  it("still throws an understudy method error after recording it", async () => {
    const logs: StagehandLog[] = [];
    const tracing: StagehandTracing = {
      tracer: trace.getTracer("stagehand-logging-migration-test"),
      configure: async () => {},
      forceFlush: async () => {},
      shutdown: async () => {},
    };
    const logger = new StagehandLogger(tracing, (log) => logs.push(log));
    logger.setLevel("debug");
    const frame = {
      evaluate: async () => "https://example.com",
    } as unknown as Frame;

    await expect(
      performUnderstudyMethod({} as Page, frame, "unsupported", "button", [], logger),
    ).rejects.toThrow("Method unsupported not supported");

    expect(logs).toContainEqual(
      expect.objectContaining({
        message: "Error performing method",
        data: expect.objectContaining({ error: "Method unsupported not supported" }) as object,
      }),
    );
  });

  it("emits info and higher logs while filtering debug by default", () => {
    const logs: StagehandLog[] = [];
    const logger = new StagehandLogger(
      { tracer: trace.getTracer("stagehand-logging-level-test") },
      (log) => logs.push(log),
    );

    logger.debug("hidden", {});
    logger.info("visible info", {});
    logger.warn("visible warning", {});
    logger.error("visible error", {});

    expect(logs.map(({ level, message }) => ({ level, message }))).toStrictEqual([
      { level: "info", message: "visible info" },
      { level: "warn", message: "visible warning" },
      { level: "error", message: "visible error" },
    ]);
  });
});

async function findExtensionSourceMatches(pattern: RegExp): Promise<string[]> {
  return await findSourceMatches(pattern, ["extension"]);
}

async function findSourceMatches(pattern: RegExp, directories: string[]): Promise<string[]> {
  const files = (
    await Promise.all(
      directories.map((directory) => listTypeScriptFiles(path.join(PACKAGES_ROOT, directory))),
    )
  ).flat();
  const matches: string[] = [];

  for (const file of files) {
    if (file.includes(`${path.sep}tests${path.sep}`) || file.includes(".test.")) continue;
    const source = await readFile(file, "utf8");
    if (pattern.test(source)) matches.push(path.relative(PACKAGES_ROOT, file));
  }

  return matches.sort();
}

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return await listTypeScriptFiles(file);
      return entry.isFile() && file.endsWith(".ts") ? [file] : [];
    }),
  );
  return files.flat();
}
