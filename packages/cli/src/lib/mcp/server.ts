import { browserbase, localBrowser, Stagehand } from "@browserbasehq/stagehand";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Middleware } from "./contract.js";

type Resources = { tools: InstanceType<Middleware["StagehandFacadeTools"]> };

export function createStagehandMcp(
  version: string,
  middleware: Middleware,
  env: NodeJS.ProcessEnv = process.env,
) {
  const {
    CodeModeRunInputSchema,
    facadeAgentInstructions,
    facadeToolsFor,
    ScreenshotInputSchema,
    SnapshotInputSchema,
    stagehandFacadeConfigFromEnv,
    StagehandFacadeTools,
  } = middleware;
  const server = new McpServer(
    { name: "stagehand", version },
    { instructions: facadeAgentInstructions(env) },
  );
  let resourcesPromise: Promise<Resources> | undefined;
  let closePromise: Promise<void> | undefined;
  let closing = false;

  async function createResources(): Promise<Resources> {
    const config = stagehandFacadeConfigFromEnv(env);
    const browser =
      config.browser.type === "browserbase"
        ? await browserbase.launch(config.browser.launchOptions)
        : await localBrowser.launch(config.browser.launchOptions);
    let stagehand: Stagehand | undefined;
    try {
      stagehand = await Stagehand.create({ browser, ...config.stagehand });
      return {
        tools: new StagehandFacadeTools(stagehand, {
          quietWait: config.quietWait,
        }),
      };
    } catch (error) {
      await Promise.allSettled([stagehand?.close(), browser.close()]);
      throw error;
    }
  }

  async function tools(): Promise<Resources["tools"]> {
    if (closing) throw new Error("Stagehand MCP is closing.");
    resourcesPromise ??= createResources().catch((error) => {
      resourcesPromise = undefined;
      throw error;
    });
    return (await resourcesPromise).tools;
  }

  // Preserve the middleware's JSON schemas through the underlying protocol API.
  // Declaring tools on McpServer instead would install its own handlers here.
  server.server.registerCapabilities({ tools: {} });
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...facadeToolsFor("playwright", env)],
  }));
  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const args = request.params.arguments ?? {};
      switch (request.params.name) {
        case "run": {
          const input = CodeModeRunInputSchema.parse(args);
          const facade = await tools();
          const result =
            input.code === undefined
              ? await facade.runActions(input.actions!)
              : await facade.run(input.code);
          return textResult(
            typeof result === "string"
              ? result
              : (JSON.stringify(result) ?? "null"),
          );
        }
        case "snapshot": {
          const input = SnapshotInputSchema.parse(args);
          return textResult(await (await tools()).snapshot(input));
        }
        case "screenshot": {
          const input = ScreenshotInputSchema.parse(args);
          const image = await (await tools()).screenshot(input);
          return {
            content: [
              {
                type: "image" as const,
                data: image.data,
                mimeType: image.mimeType,
              },
            ],
          };
        }
        default:
          throw new Error(`Unknown tool: ${request.params.name}`);
      }
    } catch (error) {
      return { ...textResult(errorMessage(error, env)), isError: true };
    }
  });

  return {
    server,
    close(): Promise<void> {
      closing = true;
      return (closePromise ??= (async () => {
        const resources = await resourcesPromise?.catch(() => undefined);
        try {
          await resources?.tools.close();
        } finally {
          await server.close();
        }
      })());
    },
  };
}

function textResult(text: string) {
  const safe = text.replace(
    /[\u0085\u2028\u2029]/gu,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return { content: [{ type: "text" as const, text: safe }] };
}

function errorMessage(error: unknown, env: NodeJS.ProcessEnv): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const [name, value] of Object.entries(env)) {
    if (value && /(?:KEY|TOKEN|SECRET|PASSWORD)$/i.test(name))
      message = message.replaceAll(value, "[redacted]");
  }
  return message
    .replace(
      /([?&](?:signingKey|apiKey|api_key|token|key)=)[^&\s"']+/gi,
      "$1[redacted]",
    )
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[redacted]");
}

export async function startStagehandMcp(
  version: string,
  middleware: Middleware,
): Promise<void> {
  const host = createStagehandMcp(version, middleware);
  let stopping = false;
  async function stop(code: number): Promise<void> {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 5_000);
    try {
      await host.close();
    } catch (error) {
      process.stderr.write(`${errorMessage(error, process.env)}\n`);
      code = 1;
    } finally {
      clearTimeout(deadline);
      process.exit(code);
    }
  }
  process.once("SIGINT", () => void stop(130));
  process.once("SIGTERM", () => void stop(143));
  process.stdin.once("end", () => void stop(0));
  process.stdin.once("close", () => void stop(0));
  try {
    await host.server.connect(new StdioServerTransport());
    process.stderr.write("Stagehand MCP listening on stdio\n");
  } catch (error) {
    process.stderr.write(`${errorMessage(error, process.env)}\n`);
    await stop(1);
  }
}
