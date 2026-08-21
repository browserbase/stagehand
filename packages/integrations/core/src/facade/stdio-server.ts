#!/usr/bin/env node

import {
  browserbase,
  localBrowser,
  Stagehand,
  type StagehandBrowser,
} from "@browserbasehq/stagehand";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { closeCodeModeStdio } from "../codemode/stdio-lifecycle.js";
import { stagehandFacadeConfigFromEnv } from "./config.js";
import {
  CodeModeRunInputSchema,
  FACADE_TOOLS,
  SCREENSHOT_TOOL_DESCRIPTION,
  SNAPSHOT_TOOL_DESCRIPTION,
  ScreenshotInputSchema,
  SnapshotInputSchema,
} from "./contract.js";
import {
  captureScreenshotWithinBase64Budget,
  screenshotBase64BudgetFromArgs,
} from "./screenshot-transport.js";
import { releaseBrowserbaseSession } from "./session-release.js";
import { StagehandFacadeTools } from "./tools.js";

type FacadeResources = {
  browser: StagehandBrowser;
  stagehand: Stagehand;
  tools: StagehandFacadeTools;
  releaseSession?: () => Promise<void>;
};

const server = new McpServer({ name: "stagehand-facade", version: "4.0.0" });
const screenshotBase64Budget = screenshotBase64BudgetFromArgs(process.argv.slice(2));
let resources: FacadeResources | undefined;
let resourcesPromise: Promise<FacadeResources> | undefined;
let cleanupPromise: Promise<void> = Promise.resolve();
const cleanupTargets = new Set<() => Promise<void>>();
let closing = false;

server.registerTool(
  "run",
  { description: FACADE_TOOLS[0].description, inputSchema: CodeModeRunInputSchema },
  async () => ({ content: [] }),
);
server.registerTool(
  "snapshot",
  { description: SNAPSHOT_TOOL_DESCRIPTION, inputSchema: SnapshotInputSchema },
  async () => ({ content: [] }),
);
server.registerTool(
  "screenshot",
  { description: SCREENSHOT_TOOL_DESCRIPTION, inputSchema: ScreenshotInputSchema },
  async () => ({ content: [] }),
);

server.server.removeRequestHandler("tools/list");
server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [...FACADE_TOOLS] }));
server.server.removeRequestHandler("tools/call");
server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const args = request.params.arguments ?? {};
    switch (request.params.name) {
      case "run": {
        const input = CodeModeRunInputSchema.parse(args);
        const tools = (await ensureResources()).tools;
        const result =
          input.code === undefined
            ? await tools.runActions(input.actions!)
            : await tools.run(input.code);
        return textResult(stringifyResult(result));
      }
      case "snapshot": {
        const input = SnapshotInputSchema.parse(args);
        const result = await (await ensureResources()).tools.snapshot(input);
        return textResult(result);
      }
      case "screenshot": {
        const input = ScreenshotInputSchema.parse(args);
        const tools = (await ensureResources()).tools;
        const screenshot =
          screenshotBase64Budget === undefined
            ? { image: await tools.screenshot(input), adjusted: false }
            : await captureScreenshotWithinBase64Budget(
                (options) => tools.screenshot(options),
                input,
                screenshotBase64Budget,
              );
        return {
          content: [
            {
              type: "text" as const,
              text: screenshot.adjusted
                ? "Screenshot captured with transport-safe compression."
                : "Screenshot captured.",
            },
            {
              type: "image" as const,
              data: screenshot.image.data,
              mimeType: screenshot.image.mimeType,
            },
          ],
        };
      }
      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    return errorResult(error);
  }
});

async function ensureResources(): Promise<FacadeResources> {
  if (resources && !resources.browser.closed) return resources;

  resourcesPromise ??= cleanupPromise.then(retryCleanupTargets).then(createResources);
  const pending = resourcesPromise;
  try {
    const created = await pending;
    if (resourcesPromise === pending) resources = created;
    return created;
  } finally {
    if (resourcesPromise === pending) resourcesPromise = undefined;
  }
}

async function createResources(): Promise<FacadeResources> {
  const config = stagehandFacadeConfigFromEnv();
  const browser =
    config.browser.type === "browserbase"
      ? await browserbase.launch(config.browser.launchOptions)
      : await localBrowser.launch(config.browser.launchOptions);
  const sessionId = browser.sessionId;
  let releaseSession: (() => Promise<void>) | undefined;
  if (config.browser.type === "browserbase" && sessionId) {
    const { apiKey, baseUrl } = config.browser.launchOptions;
    releaseSession = () => releaseBrowserbaseSession({ apiKey, baseUrl, sessionId });
  }
  try {
    const stagehand = await Stagehand.create({ browser, ...config.stagehand });
    let tools: StagehandFacadeTools;
    tools = new StagehandFacadeTools(stagehand, {
      close: () => closeRequestedResources(tools),
    });
    return { browser, stagehand, tools, ...(releaseSession ? { releaseSession } : {}) };
  } catch (error) {
    const cleanupErrors: unknown[] = [error];
    let browserCloseFailed = false;
    await browser.close().catch((cleanupError) => {
      browserCloseFailed = true;
      cleanupErrors.push(cleanupError);
    });
    if (browserCloseFailed && releaseSession) {
      await releaseSession().catch((releaseError) => {
        cleanupTargets.add(releaseSession);
        cleanupErrors.push(releaseError);
      });
    }
    if (cleanupErrors.length === 1) throw error;
    throw new AggregateError(
      cleanupErrors,
      "Stagehand initialization failed and browser cleanup also failed.",
      { cause: error },
    );
  }
}

async function closeRequestedResources(expected: StagehandFacadeTools): Promise<void> {
  const current = resources;
  if (!current || current.tools !== expected) return;

  resources = undefined;
  const closeResult = cleanupPromise.then(() => closeResources(current));
  cleanupPromise = closeResult.then(
    () => undefined,
    () => undefined,
  );
  await closeResult;
}

async function closeResources(current: FacadeResources): Promise<void> {
  const cleanupErrors: unknown[] = [];
  let browserCloseFailed = false;
  await current.stagehand.close().catch((error) => cleanupErrors.push(error));
  await current.browser.close().catch((error) => {
    browserCloseFailed = true;
    cleanupErrors.push(error);
  });
  if (browserCloseFailed && current.releaseSession) {
    cleanupTargets.add(current.releaseSession);
  } else if (current.releaseSession) {
    cleanupTargets.delete(current.releaseSession);
  }
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) {
    throw new AggregateError(cleanupErrors, "Failed to close the browser session cleanly.");
  }
}

async function retryCleanupTargets(): Promise<void> {
  for (const releaseSession of cleanupTargets) {
    await releaseSession();
    cleanupTargets.delete(releaseSession);
  }
}

async function closeResourcesForShutdown(current: FacadeResources): Promise<void> {
  try {
    await closeResources(current);
  } finally {
    if (current.releaseSession && cleanupTargets.has(current.releaseSession)) {
      await current.releaseSession();
      cleanupTargets.delete(current.releaseSession);
    }
  }
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(error: unknown) {
  const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function stringifyResult(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/([?&](?:signingKey|apiKey|api_key|token|key)=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/\b(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/g, "$1[redacted]")
    .replace(/\b(bb_(?:live|test)_[A-Za-z0-9]{4})[A-Za-z0-9_-]+/g, "$1[redacted]")
    .replace(/\bAIza[0-9A-Za-z_-]{30,}/g, "AIza[redacted]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[redacted]");
}

async function shutdown(code: number): Promise<void> {
  if (closing) return;
  closing = true;
  // Wait for a launch and any explicit close already in flight. Failed close
  // targets remain tracked so shutdown can make one final best-effort attempt.
  const launched = await Promise.race([
    (async () => {
      const pending = await resourcesPromise?.catch(() => undefined);
      await cleanupPromise;
      return pending;
    })(),
    new Promise<undefined>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  const retryTargets = new Set(cleanupTargets);
  const activeTargets = new Set<FacadeResources>();
  if (resources) activeTargets.add(resources);
  if (launched) activeTargets.add(launched);
  const clean = await closeCodeModeStdio([
    ...[...retryTargets].map((releaseSession) => ({ close: releaseSession })),
    ...[...activeTargets].map((target) => ({
      close: () => closeResourcesForShutdown(target),
    })),
    server,
  ]);
  if (!clean) process.stderr.write("Failed to close Stagehand facade cleanly.\n");
  process.exit(code === 0 && !clean ? 1 : code);
}

process.once("SIGINT", () => void shutdown(130));
process.once("SIGTERM", () => void shutdown(143));
process.stdin.once("end", () => void shutdown(0));
process.stdin.once("close", () => void shutdown(0));

try {
  await server.connect(new StdioServerTransport());
  process.stderr.write("Stagehand facade MCP host listening on stdio\n");
} catch (error) {
  process.stderr.write(
    sanitizeErrorMessage(error instanceof Error ? error.message : String(error)) + "\n",
  );
  await shutdown(1);
}
