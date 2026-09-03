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
import { sanitizeErrorMessage } from "../harness/redact.js";
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
import { StagehandFacadeTools } from "./tools.js";

type FacadeResources = {
  browser: StagehandBrowser;
  stagehand: Stagehand;
  tools: StagehandFacadeTools;
};

const server = new McpServer({ name: "stagehand-facade", version: "4.0.0" });
const screenshotBase64Budget = screenshotBase64BudgetFromArgs(process.argv.slice(2));
let resourcesPromise: Promise<FacadeResources> | undefined;
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
  resourcesPromise ??= createResources().catch((error) => {
    resourcesPromise = undefined;
    throw error;
  });
  return await resourcesPromise;
}

async function createResources(): Promise<FacadeResources> {
  const config = stagehandFacadeConfigFromEnv();
  const browser =
    config.browser.type === "browserbase"
      ? await browserbase.launch(config.browser.launchOptions)
      : await localBrowser.launch(config.browser.launchOptions);
  try {
    const stagehand = await Stagehand.create({ browser, ...config.stagehand });
    return { browser, stagehand, tools: new StagehandFacadeTools(stagehand) };
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
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

async function shutdown(code: number): Promise<void> {
  if (closing) return;
  closing = true;
  // A launch still in flight must not stall shutdown past the grace window.
  const resources = await Promise.race([
    resourcesPromise?.catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  const clean = await closeCodeModeStdio([
    ...(resources
      ? [
          {
            close: async () => {
              await resources.stagehand.close().catch(() => undefined);
              await resources.browser.close();
            },
          },
        ]
      : []),
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
