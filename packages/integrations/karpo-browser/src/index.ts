import {
  runDeepagentsSession,
  type DeepagentsMcpServerConfig,
  type DeepagentsProcessSpawner,
  type DeepagentsSessionResult,
} from "@browserbasehq/stagehand-integrations-deepagents-sdk";
import type { HarnessLogger } from "@browserbasehq/stagehand-integrations/harness";

export const KARPO_BROWSER_HARNESS = "karpo_browser";

/** Absolute path of karpo-browser's eval agent, `evals/stagehand/agent.sh` in its repository. */
export const KARPO_BROWSER_PATH_ENV = "EVAL_KARPO_BROWSER_PATH";

export type KarpoBrowserSessionConfig = {
  agentPath: string;
  cwd?: string;
  env: Record<string, string>;
  mcpServers: Record<string, DeepagentsMcpServerConfig>;
  systemPrompt: string;
  maxToolSteps: number;
  resultSchema?: Record<string, unknown>;
  instruction: string;
  startUrl: string;
  runSeconds: number;
  /** Where the agent writes its execution records. */
  recordsDir?: string;
};

/**
 * Runs karpo-browser's eval agent on one task. The agent speaks the Deep Agents
 * runner protocol; its stdin task also carries the task's instruction, start
 * URL, time limit and records directory.
 */
export function runKarpoBrowserSession(input: {
  prompt: string;
  model: string;
  logger: HarnessLogger;
  session: KarpoBrowserSessionConfig;
  signal?: AbortSignal;
  spawn?: DeepagentsProcessSpawner;
  onToolResult?: (toolName: string, server?: string) => void | Promise<void>;
}): Promise<DeepagentsSessionResult> {
  const { session } = input;
  return runDeepagentsSession({
    prompt: input.prompt,
    model: input.model,
    logger: input.logger,
    ...(input.signal && { signal: input.signal }),
    ...(input.spawn && { spawn: input.spawn }),
    ...(input.onToolResult && { onToolResult: input.onToolResult }),
    session: {
      program: { command: session.agentPath, name: KARPO_BROWSER_HARNESS },
      ...(session.cwd && { cwd: session.cwd }),
      env: session.env,
      mcpServers: session.mcpServers,
      systemPrompt: session.systemPrompt,
      // The agent stops at max_tool_steps; the protocol requires recursion_limit too.
      recursionLimit: session.maxToolSteps,
      maxToolSteps: session.maxToolSteps,
      ...(session.resultSchema && { resultSchema: session.resultSchema }),
      extraInput: {
        instruction: session.instruction,
        start_url: session.startUrl,
        run_seconds: session.runSeconds,
        records_dir: session.recordsDir ?? null,
      },
    },
  });
}
