import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { STAGEHAND_CODEMODE_SKILL } from "@browserbasehq/stagehand-integrations/codemode";
import { generateText, stepCountIs, type LanguageModel, type ToolSet } from "ai";
import { Sandbox } from "e2b";

const E2B_MCP_PROTOCOL_VERSION = "2025-06-18";
const E2B_STAGEHAND_SERVER = "github/browserbase/stagehand";
export const STAGEHAND_TOOL_NAME = "stagehand_code_execute";

export type StagehandSandboxOptions = {
  stagehandRevision: string;
  browserbaseApiKey: string;
  browserbaseProjectId: string;
  stagehandModelName?: string;
  stagehandModelApiKey?: string;
  readinessTimeoutMs?: number;
  sandboxTimeoutMs?: number;
};

export type StagehandMcpBinding = {
  client: MCPClient;
  sandbox: Sandbox;
  tools: ToolSet;
  close: () => Promise<void>;
};

export type StagehandAgentResult = {
  text: string;
  toolNames: string[];
  toolOutputs: unknown[];
};

export async function createStagehandMcpBinding(
  options: StagehandSandboxOptions,
): Promise<StagehandMcpBinding> {
  assertCommitHash(options.stagehandRevision);
  const sandboxEnvironment = stagehandEnvironment(options);
  let sandbox: Sandbox | undefined;
  let client: MCPClient | undefined;

  try {
    sandbox = await Sandbox.create({
      timeoutMs: options.sandboxTimeoutMs ?? 20 * 60_000,
      envs: sandboxEnvironment,
      mcp: {
        [E2B_STAGEHAND_SERVER]: {
          installCmd: [
            `git checkout --detach ${options.stagehandRevision}`,
            "pnpm install --frozen-lockfile",
            "pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations...",
          ].join(" && "),
          runCmd: "node packages/integrations/dist/codemode/stdio-server.mjs",
        },
      },
    });

    const token = await sandbox.getMcpToken();
    if (!token) throw new Error("E2B did not return an MCP gateway token");

    const connected = await connectWhenReady(
      sandbox.getMcpUrl(),
      token,
      options.readinessTimeoutMs ?? 12 * 60_000,
    );
    client = connected.client;

    return {
      client,
      sandbox,
      // The MCP package and AI SDK expose structurally compatible tools through
      // separate provider type versions. Keep the cast at this adapter boundary.
      tools: { [STAGEHAND_TOOL_NAME]: connected.codeExecute } as ToolSet,
      close: () => closeResources(client, sandbox),
    };
  } catch (error) {
    await closeResources(client, sandbox).catch(() => undefined);
    throw error;
  }
}

export async function runStagehandAgent(
  model: LanguageModel,
  prompt: string,
  options: StagehandSandboxOptions,
): Promise<StagehandAgentResult> {
  const binding = await createStagehandMcpBinding(options);
  let primaryError: unknown;

  try {
    const result = await generateText({
      model,
      instructions: STAGEHAND_CODEMODE_SKILL,
      prompt,
      tools: binding.tools,
      stopWhen: stepCountIs(8),
    });
    return {
      text: result.text,
      toolNames: result.steps.flatMap((step) => step.toolCalls.map((call) => call.toolName)),
      toolOutputs: result.steps.flatMap((step) =>
        step.toolResults.map((toolResult) => toolResult.output),
      ),
    };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await binding.close();
    } catch (cleanupError) {
      if (primaryError === undefined) throw cleanupError;
    }
  }
}

async function connectWhenReady(
  url: string,
  token: string,
  timeoutMs: number,
): Promise<{
  client: MCPClient;
  codeExecute: Awaited<ReturnType<MCPClient["tools"]>>[string];
}> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    let candidate: MCPClient | undefined;
    try {
      candidate = await createMCPClient({
        clientName: "stagehand-e2b-vercel",
        transport: {
          type: "http",
          url,
          headers: { Authorization: `Bearer ${token}` },
          // E2B's current MCP gateway rejects the newer default protocol version.
          initialProtocolVersion: E2B_MCP_PROTOCOL_VERSION,
        },
      });
      const remoteTools = await candidate.tools();
      const entries = Object.entries(remoteTools).filter(([name]) => name.endsWith("code_execute"));
      if (entries.length !== 1 || !entries[0]?.[1]) {
        throw new Error(
          `Expected one Stagehand code_execute tool, received: ${Object.keys(remoteTools).join(", ") || "none"}`,
        );
      }
      return { client: candidate, codeExecute: entries[0][1] };
    } catch (error) {
      lastError = error;
      await candidate?.close().catch(() => undefined);
      await delay(5_000);
    }
  }

  throw new Error("Timed out waiting for the Stagehand MCP server in E2B", { cause: lastError });
}

function stagehandEnvironment(options: StagehandSandboxOptions): Record<string, string> {
  const environment: Record<string, string> = {
    STAGEHAND_BROWSER: "browserbase",
    BROWSERBASE_API_KEY: options.browserbaseApiKey,
    BROWSERBASE_PROJECT_ID: options.browserbaseProjectId,
  };
  if (options.stagehandModelName) environment.STAGEHAND_MODEL_NAME = options.stagehandModelName;
  if (options.stagehandModelApiKey) {
    environment.STAGEHAND_MODEL_API_KEY = options.stagehandModelApiKey;
  }
  return environment;
}

async function closeResources(client?: MCPClient, sandbox?: Sandbox): Promise<void> {
  const errors: unknown[] = [];
  try {
    await client?.close();
  } catch (error) {
    errors.push(error);
  }
  try {
    await sandbox?.kill();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) throw new AggregateError(errors, "Could not close the Stagehand sandbox");
}

function assertCommitHash(revision: string): void {
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error("stagehandRevision must be a complete 40-character Git commit hash");
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
