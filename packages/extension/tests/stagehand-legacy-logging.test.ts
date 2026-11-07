import { ROOT_CONTEXT, SpanStatusCode, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-web";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StagehandLog, StagehandLogLevel } from "@browserbasehq/stagehand-protocol/types";
import { performUnderstudyMethod } from "../handlers/handlerUtils/actHandlerUtils.js";
import { StagehandLogger, type StagehandLogThreshold } from "../logger.js";
import type { StagehandTracing } from "../tracing.js";
import { createStagehandTracingRuntime } from "../tracing.js";
import type { Frame } from "../understudy/frame.js";
import type { Page } from "../understudy/page.js";
import { Progress } from "../understudy/progress.js";

const PACKAGES_ROOT = path.resolve(import.meta.dirname, "../..");
const runtimes: Array<{ shutdown(): Promise<void> }> = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.shutdown()));
});

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
      performUnderstudyMethod(
        {} as Page,
        frame,
        "unsupported",
        "button",
        [],
        logger,
        new Progress("act()", 0),
      ),
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

  it.each<StagehandLogThreshold>(["debug", "info", "warn", "error", "off"])(
    "only creates log spans for records enabled at %s",
    (threshold) => {
      const levels: StagehandLogLevel[] = ["debug", "info", "warn", "error"];
      const logs: StagehandLog[] = [];
      const tracer = trace.getTracer("stagehand-log-filter-test");
      const startSpan = vi.spyOn(tracer, "startSpan");
      const logger = new StagehandLogger({ tracer }, (log) => logs.push(log), undefined, threshold);

      for (const level of levels) logger.write(level, level, { level });

      const expected = threshold === "off" ? [] : levels.slice(levels.indexOf(threshold));
      expect(logs.map((log) => log.level)).toEqual(expected);
      expect(startSpan.mock.calls.map(([name]) => name)).toEqual(expected);
    },
  );

  it("does not read or serialize suppressed data", () => {
    const tracer = trace.getTracer("stagehand-suppressed-data-test");
    const startSpan = vi.spyOn(tracer, "startSpan");
    const emitLog = vi.fn();
    const readData = vi.fn(() => {
      throw new Error("Suppressed data must not be inspected");
    });
    const data = Object.defineProperty({}, "value", { enumerable: true, get: readData });
    const logger = new StagehandLogger({ tracer }, emitLog);
    const stringify = vi.spyOn(JSON, "stringify");

    expect(() => logger.debug("hidden", data)).not.toThrow();
    logger.setLevel("off");
    expect(() => logger.error("also hidden", data)).not.toThrow();

    expect(readData).not.toHaveBeenCalled();
    expect(stringify).not.toHaveBeenCalled();
    expect(startSpan).not.toHaveBeenCalled();
    expect(emitLog).not.toHaveBeenCalled();
  });

  it("keeps enabled validation and unknown runtime level errors", () => {
    const logger = new StagehandLogger(
      { tracer: trace.getTracer("stagehand-invalid-log-test") },
      () => {},
    );
    expect(() => logger.info("", {})).toThrow();
    logger.setLevel("off");
    expect(() => logger.write("invalid" as StagehandLogLevel, "invalid level", {})).toThrow();
  });

  it("honors a level change while preparing an enabled log", () => {
    const emitLog = vi.fn();
    const logger = new StagehandLogger(
      { tracer: trace.getTracer("stagehand-reentrant-log-test") },
      emitLog,
    );
    logger.info("disabled during validation", {
      get value() {
        logger.setLevel("off");
        return 42;
      },
    });

    expect(emitLog).not.toHaveBeenCalled();
  });

  it("preserves enabled log data and parent context after a level change", () => {
    const tracer = trace.getTracer("stagehand-enabled-log-test");
    const startSpan = vi.spyOn(tracer, "startSpan");
    const logs: StagehandLog[] = [];
    const logger = new StagehandLogger({ tracer }, (log) => logs.push(log));
    logger.setLevel("debug");
    const parent = ROOT_CONTEXT.setValue(Symbol("parent"), "request");
    const scoped = logger.withContext(parent);
    scoped.debug("visible", { nested: { value: 42 } });

    expect(logs).toEqual([{ level: "debug", message: "visible", data: { nested: { value: 42 } } }]);
    expect(startSpan).toHaveBeenCalledWith(
      "visible",
      {
        attributes: {
          "stagehand.span.type": "log",
          "stagehand.log.level": "debug",
          "stagehand.log.message": "visible",
          "stagehand.log.data": '{"nested":{"value":42}}',
        },
      },
      parent,
    );
  });

  it("keeps successful and failed operation spans when all logs are off", async () => {
    const exporter = new InMemorySpanExporter();
    const tracing = createStagehandTracingRuntime(
      { registerGlobals: false },
      { spanProcessors: [new SimpleSpanProcessor(exporter)] },
    );
    runtimes.push(tracing);
    const emitLog = vi.fn();
    const logger = new StagehandLogger(tracing, emitLog, undefined, "off");
    const failure = new Error("operation failed");

    await expect(
      logger.span("success", { value: 42 }, (scoped) => {
        scoped.debug("hidden debug", {});
        return 42;
      }),
    ).resolves.toBe(42);
    await expect(
      logger.span("failure", {}, (scoped) => {
        scoped.error("hidden error", {});
        throw failure;
      }),
    ).rejects.toBe(failure);
    await tracing.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans.map((span) => span.name)).toEqual(["success", "failure"]);
    expect(spans.every((span) => span.attributes["stagehand.span.type"] === "operation")).toBe(
      true,
    );
    expect(spans[0]?.attributes["stagehand.span.data"]).toBe('{"value":42}');
    expect(spans[1]?.status).toEqual({ code: SpanStatusCode.ERROR, message: failure.message });
    expect(spans[1]?.events).toContainEqual(expect.objectContaining({ name: "exception" }));
    expect(emitLog).not.toHaveBeenCalled();
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
