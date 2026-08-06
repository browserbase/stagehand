import { describe, expect, it, vi } from "vitest";
import { executeStagehandSnippet } from "../src/codemode/snippet.js";

const page = { marker: "page" };
const context = { marker: "context" };
const stagehand = { marker: "stagehand" };

describe("executeStagehandSnippet", () => {
  it("injects browser, Stagehand, Zod, custom bindings, and console", async () => {
    const codeConsole = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const result = await executeStagehandSnippet({
      code: `
        console.log(label);
        return {
          page: page.marker,
          context: context.marker,
          stagehand: stagehand.marker,
          parsed: z.object({ value: z.number() }).parse({ value: count }).value,
        };
      `,
      page: page as never,
      context: context as never,
      stagehand: stagehand as never,
      bindings: { label: "ready", count: 3 },
      console: codeConsole,
    });

    expect(result).toStrictEqual({
      page: "page",
      context: "context",
      stagehand: "stagehand",
      parsed: 3,
    });
    expect(codeConsole.log).toHaveBeenCalledWith("ready");
  });

  it("omits Stagehand and Zod in deterministic mode", async () => {
    await expect(
      executeStagehandSnippet({
        code: "return { stagehand: typeof stagehand, z: typeof z };",
        page: page as never,
        context: context as never,
      }),
    ).resolves.toStrictEqual({ stagehand: "undefined", z: "undefined" });
  });

  it("awaits asynchronous code and propagates runtime errors", async () => {
    await expect(
      executeStagehandSnippet({
        code: "return await Promise.resolve(42);",
        page: page as never,
        context: context as never,
      }),
    ).resolves.toBe(42);

    await expect(
      executeStagehandSnippet({
        code: 'throw new Error("snippet failed");',
        page: page as never,
        context: context as never,
      }),
    ).rejects.toThrow("snippet failed");
  });

  it.each(["bad-name", "await", "class"])("rejects invalid binding name %s", async (name) => {
    await expect(
      executeStagehandSnippet({
        code: "return 1;",
        page: page as never,
        context: context as never,
        bindings: { [name]: true },
      }),
    ).rejects.toThrow(`Code-mode binding "${name}" is not a valid JavaScript identifier.`);
  });

  it.each(["page", "context", "stagehand", "z", "console"])(
    "rejects reserved binding name %s",
    async (name) => {
      await expect(
        executeStagehandSnippet({
          code: "return 1;",
          page: page as never,
          context: context as never,
          bindings: { [name]: true },
        }),
      ).rejects.toThrow(`Code-mode binding "${name}" is reserved.`);
    },
  );

  it("does not persist local variables between calls", async () => {
    await executeStagehandSnippet({
      code: "const localOnly = 1; return localOnly;",
      page: page as never,
      context: context as never,
    });

    await expect(
      executeStagehandSnippet({
        code: "return localOnly;",
        page: page as never,
        context: context as never,
      }),
    ).rejects.toThrow("localOnly is not defined");
  });
});
