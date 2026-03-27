import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { V3 } from "@browserbasehq/stagehand";
import type {
  AgentHarnessOptions,
  AgentHarnessRunResult,
  AgentRunInput,
} from "../../types.js";
import { BrowserSession } from "../../browser/session.js";
import { BaseHarness } from "./base.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

export class StagehandHarness extends BaseHarness {
  readonly name = "stagehand" as const;
  private v3: V3 | null = null;
  private readonly browserSession: BrowserSession;

  constructor(options: AgentHarnessOptions, browserSession: BrowserSession) {
    super(options);
    this.browserSession = browserSession;
  }

  async start(): Promise<void> {
    if (this.v3) {
      return;
    }

    this.v3 = new V3({
      env: "LOCAL",
      localBrowserLaunchOptions: {
        cdpUrl: this.browserSession.getCdpUrl(),
      },
      model: this.options.model,
      experimental: true,
      verbose: 0,
    });
    await this.v3.init();
  }

  async stop(): Promise<void> {
    await this.v3?.close();
    this.v3 = null;
    await super.stop();
  }

  async runTurn(input: AgentRunInput): Promise<AgentHarnessRunResult> {
    await this.start();

    const integrations: Client[] = [];
    const clients: Client[] = [];
    const transports: StdioClientTransport[] = [];

    try {
      for (const serverConfig of input.mcpServers) {
        const transport = new StdioClientTransport({
          command: serverConfig.config.command,
          args: serverConfig.config.args,
          env: {
            ...process.env,
            ...(serverConfig.config.env ?? {}),
          },
          cwd: serverConfig.config.cwd,
        });
        const client = new Client({
          name: `multiagent-stagehand-${serverConfig.name}`,
          version: "0.1.0",
        });
        await client.connect(transport);
        await client.ping();
        integrations.push(client);
        clients.push(client);
        transports.push(transport);
      }

      const mode = this.options.stagehandMode ?? "dom";
      const agent = this.v3!.agent({
        mode,
        model: this.options.model,
        integrations,
      });
      const result = await agent.execute({
        instruction: input.prompt,
        maxSteps: 20,
      });

      const usage =
        isRecord(result) && isRecord(result.usage)
          ? {
              inputTokens:
                typeof result.usage.input_tokens === "number"
                  ? result.usage.input_tokens
                  : undefined,
              outputTokens:
                typeof result.usage.output_tokens === "number"
                  ? result.usage.output_tokens
                  : undefined,
              cachedInputTokens:
                typeof result.usage.cached_input_tokens === "number"
                  ? result.usage.cached_input_tokens
                  : undefined,
              raw: result.usage,
            }
          : undefined;

      return {
        content:
          isRecord(result) && typeof result.message === "string"
            ? result.message
            : JSON.stringify(result),
        raw: result,
        usage,
      };
    } finally {
      await Promise.all(clients.map(async (client) => await client.close()));
      await Promise.all(
        transports.map(async (transport) => await transport.close()),
      );
    }
  }
}
