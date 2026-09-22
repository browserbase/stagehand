import { runUnrealSession } from "@browserbasehq/stagehand-integrations-unreal-agent-sdk";
import type { AvailableModel } from "stagehand-v3";
import type { EvalLogger } from "../logger.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import type { UnrealAgentToolAdapter } from "./unrealAgentToolAdapter.js";
import type { ExternalHarnessVerifierConfig } from "./verifierAdapter.js";
import type { TaskResult } from "./types.js";
import { metricValue, runExternalHarnessTask } from "./harnesses/externalRunner.js";
import { unrealAgentTrajectory } from "./harnesses/unrealAgentAdapter.js";

export async function runUnrealAgent(input: {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter: UnrealAgentToolAdapter;
  signal?: AbortSignal;
  verifier: ExternalHarnessVerifierConfig;
}): Promise<TaskResult> {
  const adapter = input.toolAdapter;
  const result = await runExternalHarnessTask({
    harness: "unreal_agent",
    plan: input.plan,
    logger: input.logger,
    toolAdapter: adapter,
    verifier: input.verifier,
    resultContract: "marker",
    fallbackErrorMessage: "Unreal Agent did not report success",
    isFacadeTool: (name) => name.startsWith("facade."),
    runSession: async (prompt) => {
      const result = await runUnrealSession({
        prompt,
        model: input.model,
        workspace: adapter.cwd,
        env: adapter.env,
        signal: input.signal,
      });
      return {
        raw: result,
        resultText: result.finalMessage,
        transcriptText: result.events.map((event) => JSON.stringify(event)).join("\n"),
        iterationError: result.iterationError,
        status: result.status === "aborted" ? "sdk_error" : result.status,
        stopReason: result.stopReason,
        usage: {
          inputTokens: result.tokenUsage.inputTokens,
          outputTokens: result.tokenUsage.outputTokens,
          cachedInputTokens: result.tokenUsage.cachedInputTokens,
          reasoningOutputTokens: result.tokenUsage.reasoningOutputTokens,
          totalTokens: result.tokenUsage.inputTokens + result.tokenUsage.outputTokens,
        },
        metrics: {
          facade_tool_calls: metricValue(adapter.facadeCalls.length),
          unreal_agent_input_tokens: metricValue(result.tokenUsage.inputTokens),
          unreal_agent_output_tokens: metricValue(result.tokenUsage.outputTokens),
        },
      };
    },
    toTrajectory: ({ raw, parsed, finalObservation, stepObservations, status }, taskSpec) =>
      unrealAgentTrajectory({
        taskSpec,
        toolCalls: raw.toolCalls,
        facadeCalls: adapter.facadeCalls,
        finalAnswer: parsed.finalAnswer ?? raw.finalMessage,
        status,
        usage: {
          input_tokens: raw.tokenUsage.inputTokens,
          output_tokens: raw.tokenUsage.outputTokens,
          cached_input_tokens: raw.tokenUsage.cachedInputTokens,
          reasoning_tokens: raw.tokenUsage.reasoningOutputTokens,
        },
        finalObservation,
        stepObservations,
      }),
  });
  if (adapter.facadeCalls.length === 0) {
    return {
      ...result,
      _success: false,
      error: "Unreal Agent did not call the Stagehand facade.",
      outcomeGates: ["no_browser_use"],
    };
  }
  return result;
}
