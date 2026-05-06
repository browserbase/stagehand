import { EvalsError } from "../errors.js";
import { runCodexAgent } from "./codexRunner.js";
import { prepareCodexToolAdapter } from "./codexToolAdapter.js";
import { buildExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import type {
  BenchHarness,
  BenchHarnessExecuteInput,
  StartedBenchHarness,
} from "./benchHarness.js";
import type { TaskResult } from "./types.js";

export const CodexAgentHarness: BenchHarness = {
  harness: "codex",
  supportedTaskKinds: ["agent", "suite"],
  supportsApi: false,
  async execute({
    input,
    row,
    logger,
    signal,
  }: BenchHarnessExecuteInput): Promise<TaskResult> {
    const plan = buildExternalHarnessTaskPlan(input);
    if (row.config.harness !== "codex") {
      throw new EvalsError(
        `Expected codex harness config, received "${row.config.harness}".`,
      );
    }
    const toolAdapter = await prepareCodexToolAdapter({
      toolSurface: row.config.toolSurface,
      startupProfile: row.config.startupProfile,
      environment: row.config.environment,
      plan,
      logger,
    });
    try {
      return await runCodexAgent({
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
      "Codex harness execution uses the external harness execute path. Use --dry-run to inspect its bench matrix, or run with --harness codex.",
    );
  },
};
