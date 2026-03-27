import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { V3 } from "@browserbasehq/stagehand/lib/v3/index.js";
import {
  createAgentTools,
  type V3AgentToolOptions,
} from "@browserbasehq/stagehand/lib/v3/agent/tools/index.js";
import { extractToolShape, inferIsError, safeJson } from "./stagehand-agent-utils.js";

export interface StagehandAgentMCPServerOptions {
  cdpUrl: string;
  model?: string;
  executionModel?: string;
  provider?: string;
  mode?: NonNullable<V3AgentToolOptions["mode"]>;
  excludeTools?: string[];
  toolTimeout?: number;
  variables?: V3AgentToolOptions["variables"];
  serverName?: string;
  serverVersion?: string;
}

interface StagehandToolLike {
  description?: string;
  inputSchema?: unknown;
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export async function startStagehandAgentMCPServer(
  options: StagehandAgentMCPServerOptions,
): Promise<void> {
  const v3 = new V3({
    env: "LOCAL",
    model: options.model,
    verbose: 0,
    localBrowserLaunchOptions: {
      cdpUrl: options.cdpUrl,
    },
  });
  await v3.init();

  const server = new McpServer({
    name: options.serverName ?? "multiagent-stagehand-agent",
    version: options.serverVersion ?? "0.1.0",
  });

  registerStagehandAgentTools(
    server,
    createAgentTools(v3, {
      executionModel: options.executionModel,
      provider: options.provider,
      mode: options.mode ?? "dom",
      excludeTools: options.excludeTools,
      variables: options.variables,
      toolTimeout: options.toolTimeout,
    }) as unknown as Record<string, StagehandToolLike>,
  );

  const cleanup = async () => {
    await server.close().catch(() => {});
    await v3.close().catch(() => {});
  };

  process.once("SIGINT", () => {
    void cleanup().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void cleanup().finally(() => process.exit(0));
  });
  process.once("exit", () => {
    void cleanup();
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function registerStagehandAgentTools(
  server: McpServer,
  tools: Record<string, StagehandToolLike>,
): void {
  for (const [name, tool] of Object.entries(tools)) {
    const schema = extractToolShape(tool.inputSchema as never);
    const description = tool.description ?? name;

    if (!schema) {
      server.tool(name, description, async () => {
        const result = await tool.execute({});
        return {
          content: [
            {
              type: "text",
              text: safeJson(result),
            },
          ],
          isError: inferIsError(result),
        };
      });
      continue;
    }

    server.tool(name, description, schema, async (args) => {
      const result = await tool.execute(args);
      return {
        content: [
          {
            type: "text",
            text: safeJson(result),
          },
        ],
        isError: inferIsError(result),
      };
    });
  }
}
