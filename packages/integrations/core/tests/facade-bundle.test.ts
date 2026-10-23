import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { Stagehand } from "@browserbasehq/stagehand";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it, vi } from "vitest";
import type { FacadeBundle } from "../src/facade/bundle.js";
import { RUN_EPILOGUE, RUN_PRELUDE, runCallback } from "../src/facade/batch-sources.js";
import * as contract from "../src/facade/contract.js";

// The bundle is emitted from the build, so compare it with the built facade:
// function sources are only byte-identical within one compilation. Node's own
// loader keeps them untouched; vitest's import transform would not.
const { canonicalJson, createPlaywrightCompatRuntime, StagehandFacadeTools } = createRequire(
  import.meta.url,
)("../dist/facade/index.mjs") as typeof import("../src/facade/index.js");

const packageJson = JSON.parse(
  await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };
const bundle = JSON.parse(
  await fs.readFile(new URL("../dist/facade-bundle.json", import.meta.url), "utf8"),
) as FacadeBundle;
const entrypoint = fileURLToPath(new URL("../dist/facade/stdio-server.mjs", import.meta.url));

type CompatPage = { url(): string };
type CompatContext = { pages(): unknown[] };
type CompatBrowser = { contexts(): unknown[] };

describe("facade bundle", () => {
  it("identifies its format, package version and content", () => {
    expect(bundle.version).toBe(6);
    expect(bundle.packageVersion).toBe(packageJson.version);
    const content = { sources: bundle.sources, contract: bundle.contract };
    expect(bundle.sha256).toBe(createHash("sha256").update(canonicalJson(content)).digest("hex"));
  });

  // Hosts evaluate the runtime inside a batch callback, so it must not close
  // over anything but the `__name` helper.
  it("ships the compat runtime as self-contained source", async () => {
    expect(bundle.sources.runtime).toBe(createPlaywrightCompatRuntime.toString());
    const create = new Function("__name", `return (${bundle.sources.runtime});`)(
      (target: unknown) => target,
    ) as typeof createPlaywrightCompatRuntime;
    const rawPage = {
      pageId: "test-page",
      url: vi.fn(async () => "https://example.com/"),
      evaluate: vi.fn(async () => ({ width: 800, height: 600 })),
      waitForLoadState: vi.fn(async () => undefined),
    };
    const runtime = await create({
      page: rawPage,
      context: { pages: vi.fn(async () => [rawPage]) },
    } as unknown as Parameters<typeof createPlaywrightCompatRuntime>[0]);

    expect((runtime.page as CompatPage).url()).toBe("https://example.com/");
    const [page] = (runtime.context as CompatContext).pages();
    expect(page).toBe(runtime.page);
    const [context] = (runtime.browser as CompatBrowser).contexts();
    expect(context).toBe(runtime.context);
  });

  it("sends the bundle's sources to experimentalBatch for run code and run actions", async () => {
    const page = {
      pageId: "page-1",
      url: vi.fn(async () => "https://example.com/"),
      snapshot: vi.fn(async () => ({
        formattedTree: "[0-7] button",
        xpathMap: { "0-7": "/html[1]/body[1]/button[1]" },
      })),
    };
    const sent: { source: string; input: unknown }[] = [];
    const stagehand = {
      browser: {
        context: {
          activePage: vi.fn(async () => page),
          pages: vi.fn(async () => [page]),
          setActivePage: vi.fn(async () => undefined),
        },
      },
      experimentalBatch: vi.fn(async (callback: () => unknown, input: { actions?: unknown[] }) => {
        sent.push({ source: Function.prototype.toString.call(callback), input });
        return input.actions
          ? { completed: input.actions.length }
          : {
              __stagehandPlaywrightCompat: true,
              value: "done",
              telemetry: {},
              artifacts: [],
              closeRequested: false,
              batchRuntimeMs: 0,
            };
      }),
    } as unknown as Stagehand;
    const tools = new StagehandFacadeTools(stagehand, { keeperPage: false });
    const code = 'await page.goto("https://example.com/");\nreturn "done";';

    await expect(tools.run(code)).resolves.toBe("done");
    await tools.snapshot();
    await tools.runActions([{ op: "click", id: "0-7" }]);

    expect(sent).toHaveLength(2);
    expect(sent[0]!.source).toBe(bundle.sources.runPrelude + code + bundle.sources.runEpilogue);
    // Run options are sent only when turned on (contract.runOptions).
    expect(sent[0]!.input).toStrictEqual({});
    expect(bundle.sources.runPrelude).toContain(`const createRuntime = ${bundle.sources.runtime};`);
    expect(sent[1]!.source).toBe(bundle.sources.actionRunner);
    expect(sent[1]!.input).toStrictEqual({
      actions: [{ op: "click", id: "0-7" }],
      xpathById: { "0-7": "/html[1]/body[1]/button[1]" },
    });
  });

  it("composes the run callback source as prelude + code + epilogue", () => {
    const code = "return 1;";
    expect(Function.prototype.toString.call(runCallback(code))).toBe(
      RUN_PRELUDE + code + RUN_EPILOGUE,
    );
  });

  // Joined as plain strings, this code would close the callback early and run
  // `globalThis.__escaped = 1` outside it. Hosts must reject it as TS does.
  it("rejects run code that closes the callback early", () => {
    const code =
      "})(); } catch {} }, globalThis.__escaped = 1, async function y(batchStagehand,input){ let value, executionError, runtime, __stagehandBatchStartedAt; try { value = await (async () => {";
    expect(() => runCallback(code)).toThrow(SyntaxError);
    expect(() => new Function(`return (${RUN_PRELUDE + code + RUN_EPILOGUE});`)).not.toThrow();
  });

  it("carries the contract's error messages, limits, run options and screenshot messages verbatim", () => {
    expect(bundle.contract.errors).toStrictEqual({
      NO_HYDRATED_SNAPSHOT_ERROR: contract.NO_HYDRATED_SNAPSHOT_ERROR,
      NAVIGATED_SNAPSHOT_ERROR: contract.NAVIGATED_SNAPSHOT_ERROR,
      STALE_SNAPSHOT_ID_ERROR: contract.STALE_SNAPSHOT_ID_ERROR,
      BROWSER_SESSION_LOST_ERROR: contract.BROWSER_SESSION_LOST_ERROR,
      SCREENSHOT_ARTIFACT_PATH_ERROR: contract.SCREENSHOT_ARTIFACT_PATH_ERROR,
      SCREENSHOT_ARTIFACT_SYMLINK_ERROR: contract.SCREENSHOT_ARTIFACT_SYMLINK_ERROR,
      SCREENSHOT_ARTIFACT_FILE_SYMLINK_ERROR: contract.SCREENSHOT_ARTIFACT_FILE_SYMLINK_ERROR,
      FACADE_BROWSER_CLOSED_ERROR: contract.FACADE_BROWSER_CLOSED_ERROR,
      RUN_RESULT_MALFORMED_ERROR: contract.RUN_RESULT_MALFORMED_ERROR,
      SCREENSHOT_ARTIFACT_COUNT_ERROR: contract.SCREENSHOT_ARTIFACT_COUNT_ERROR,
      SCREENSHOT_ARTIFACT_SIZE_ERROR: contract.SCREENSHOT_ARTIFACT_SIZE_ERROR,
      SCREENSHOT_ARTIFACT_TOTAL_SIZE_ERROR: contract.SCREENSHOT_ARTIFACT_TOTAL_SIZE_ERROR,
      RUN_VALUE_SIZE_ERROR: contract.RUN_VALUE_SIZE_ERROR,
    });
    expect(bundle.contract.limits).toStrictEqual(contract.RUN_RESULT_LIMITS);
    expect(bundle.contract.runOptions).toStrictEqual(contract.RUN_OPTIONS);
    expect(bundle.contract.messages).toStrictEqual({
      SCREENSHOT_CAPTURED_MESSAGE: contract.SCREENSHOT_CAPTURED_MESSAGE,
      SCREENSHOT_COMPRESSED_MESSAGE: contract.SCREENSHOT_COMPRESSED_MESSAGE,
    });
  });

  it("carries the agent instructions hosts send for each tool set", () => {
    expect(bundle.contract.instructions).toStrictEqual({
      playwright: contract.facadeAgentInstructions({}),
      legacy: contract.LEGACY_FACADE_AGENT_INSTRUCTIONS,
      explicitSnapshotActions: contract.facadeAgentInstructions({ EXPLICIT_SNAPSHOT_ACTIONS: "1" }),
    });
    expect(bundle.contract.instructions.playwright).toBe(contract.FACADE_AGENT_INSTRUCTIONS);
    expect(bundle.contract.instructions.explicitSnapshotActions).toBe(
      `${contract.FACADE_AGENT_INSTRUCTIONS}\n\n${contract.SNAPSHOT_ACTIONS_WORKFLOW}`,
    );
  });

  it.each([
    ["playwright", [], {}],
    ["legacy", ["--surface=legacy"], {}],
    ["explicitSnapshotActions", [], { EXPLICIT_SNAPSHOT_ACTIONS: "1" }],
  ] as const)(
    "matches what the built MCP server advertises for %s tools",
    async (toolSet, args, env) => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [entrypoint, ...args],
        env: { PATH: process.env.PATH ?? "", STAGEHAND_BROWSER: "invalid", ...env },
        stderr: "pipe",
      });
      const client = new Client({ name: "stagehand-facade-bundle-test", version: "1.0.0" });
      try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        expect(bundle.contract.tools[toolSet]).toStrictEqual(tools);
        // Instructions reach the agent through the host's system prompt, not
        // the server; contract.instructions is what hosts send.
        expect(client.getInstructions()).toBeUndefined();
      } finally {
        await client.close();
      }
    },
  );
});
