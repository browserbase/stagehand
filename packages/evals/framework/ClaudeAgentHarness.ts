import { EvalsError } from "../errors.js";
import { runClaudeCodeAgent } from "./claudeCodeRunner.js";
import { prepareClaudeCodeToolAdapter } from "./claudeCodeToolAdapter.js";
import { buildExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import type {
  BenchHarness,
  BenchHarnessExecuteInput,
  StartedBenchHarness,
} from "./benchHarness.js";
import type { TaskResult } from "./types.js";

export const ClaudeAgentHarness: BenchHarness = {
  harness: "claude_code",
  supportedTaskKinds: ["agent", "suite"],
  supportsApi: false,
  async execute({
    input,
    row,
    logger,
    signal,
  }: BenchHarnessExecuteInput): Promise<TaskResult> {
    const plan = buildExternalHarnessTaskPlan(input);
    if (row.config.harness !== "claude_code") {
      throw new EvalsError(
        `Expected claude_code harness config, received "${row.config.harness}".`,
      );
    }
    const toolAdapter = await prepareClaudeCodeToolAdapter({
      toolSurface: row.config.toolSurface,
      startupProfile: row.config.startupProfile,
      environment: row.config.environment,
      plan,
      logger,
    });
    try {
      return await runClaudeCodeAgent({
        plan,
        model: input.modelName,
        logger,
        toolAdapter,
        signal,
      });
    } finally {
      await toolAdapter.cleanup();
    }
  },
  async start(): Promise<StartedBenchHarness> {
    throw new EvalsError(
      "Claude Code harness execution uses the external harness execute path. Use --dry-run to inspect its bench matrix, or run with --harness claude_code.",
    );
  },
};
