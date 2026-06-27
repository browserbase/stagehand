import fs from "node:fs/promises";
import path from "node:path";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";
import {
  loadClawBenchModelConfig,
  resolveClawBenchJudgeModelName,
} from "../../../clawbench/modelConfig.js";
import {
  buildClawBenchInstruction,
  prepareClawBenchPersonalInfo,
} from "../../../clawbench/personalInfo.js";
import { judgeClawBenchInterception } from "../../../clawbench/judge.js";
import type { ClawBenchRuntime } from "../../../clawbench/runtime.js";
import type { ClawBenchRunParams } from "../../../clawbench/types.js";

function readParams(
  raw: Record<string, unknown> | undefined,
): ClawBenchRunParams {
  if (!raw || typeof raw !== "object") {
    throw new Error("Missing ClawBench params");
  }
  return raw as unknown as ClawBenchRunParams;
}

function getInjectedRuntime(
  raw: Record<string, unknown> | undefined,
): ClawBenchRuntime {
  const runtime = raw?._clawbenchRuntime;
  if (!runtime || typeof runtime !== "object") {
    throw new Error(
      "ClawBench runtime was not initialized. Run agent/clawbench with the stagehand harness in LOCAL mode.",
    );
  }
  return runtime as ClawBenchRuntime;
}

function createUploadTool(
  page: unknown,
  files: Array<{ name: string; path: string; description: string }>,
): ToolSet {
  const byName = new Map(files.map((file) => [file.name, file]));
  return {
    uploadFile: tool({
      description:
        "Upload one of the available local task files to a visible file input on the current page.",
      inputSchema: z.object({
        fileName: z
          .string()
          .describe(
            `One of: ${files.map((file) => file.name).join(", ") || "no files"}`,
          ),
        selector: z
          .string()
          .optional()
          .describe("Optional CSS selector for the input[type=file] element."),
      }),
      execute: async ({ fileName, selector }) => {
        const selected = byName.get(fileName);
        if (!selected) {
          return {
            success: false,
            error: `Unknown file "${fileName}". Available: ${[...byName.keys()].join(", ")}`,
          };
        }
        const pageAny = page as {
          locator?: (selector: string) => {
            setInputFiles?: (filePath: string) => Promise<void>;
          };
        };
        if (!pageAny.locator) {
          return { success: false, error: "Current page has no locator API" };
        }
        const locator = pageAny.locator(selector ?? 'input[type="file"]');
        if (!locator.setInputFiles) {
          return {
            success: false,
            error: "Selected element does not support setInputFiles",
          };
        }
        await locator.setInputFiles(selected.path);
        return { success: true, uploaded: selected.name };
      },
    }),
  };
}

function summarizeAgentResult(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { message: String(result ?? "") };
  }
  const obj = result as Record<string, unknown>;
  return {
    success: obj.success,
    completed: obj.completed,
    message: obj.message,
    action_count: Array.isArray(obj.actions) ? obj.actions.length : undefined,
  };
}

function summarizeAgentStep(event: {
  finishReason?: unknown;
  text?: unknown;
  reasoning?: unknown;
  toolCalls?: unknown;
  toolResults?: unknown;
  usage?: unknown;
  response?: { messages?: unknown };
}): Record<string, unknown> {
  return {
    finishReason: event.finishReason,
    text: event.text,
    reasoning: event.reasoning,
    toolCalls: event.toolCalls,
    toolResults: event.toolResults,
    usage: event.usage,
    responseMessages: event.response?.messages,
  };
}

export default defineBenchTask(
  { name: "agent/clawbench" },
  async ({ v3, logger, debugUrl, sessionUrl, modelName, input }) => {
    const params = readParams(input.params);
    const runtime = getInjectedRuntime(input.params);
    const judgeModelName = resolveClawBenchJudgeModelName();
    const judgeConfig = loadClawBenchModelConfig(judgeModelName);
    let emailCleanup: (() => Promise<void>) | undefined;

    try {
      const prepared = await prepareClawBenchPersonalInfo(
        params,
        runtime.runDir,
      );
      emailCleanup = prepared.cleanup;
      const uploadFiles = [
        {
          name: "alex_green_resume.pdf",
          path: prepared.info.resumePath,
          description: "Synthetic resume for Alex Green",
        },
        ...prepared.info.extraFiles,
      ];
      const instruction = buildClawBenchInstruction(params, prepared.info);
      const page = v3.context.pages()[0];
      const agent = v3.agent({
        mode: input.agentMode ?? (input.isCUA ? "cua" : "hybrid"),
        tools: createUploadTool(page, uploadFiles),
      });

      const maxSteps =
        Number(process.env.AGENT_EVAL_MAX_STEPS) ||
        Math.max(30, Math.ceil(params.timeLimitMinutes * 2));
      await runtime.recordAgentMessage({
        type: "execute_start",
        source: "stagehand_agent",
        caseName: params.caseName,
        taskId: params.taskId,
        model: modelName,
        mode: input.agentMode ?? (input.isCUA ? "cua" : "hybrid"),
        maxSteps,
        instruction,
      });
      let agentStep = 0;
      const agentMode = input.agentMode ?? (input.isCUA ? "cua" : "hybrid");
      const agentResult = await agent.execute({
        instruction,
        maxSteps,
        excludeTools: agentMode === "cua" ? undefined : ["screenshot"],
        callbacks: {
          onStepFinish: async (event) => {
            agentStep += 1;
            await runtime.recordAgentMessage({
              type: "step_finish",
              source: "stagehand_agent",
              step: agentStep,
              ...summarizeAgentStep(event),
            });
          },
        },
      });
      await runtime.recordAgentMessage({
        type: "execute_result",
        source: "stagehand_agent",
        ...summarizeAgentResult(agentResult),
        usage: agentResult.usage,
        output: agentResult.output,
        messages: agentResult.messages,
      });
      if (Array.isArray(agentResult.actions)) {
        for (const action of agentResult.actions) {
          await runtime.recordAction(action);
        }
      }
      logger.log({
        category: "evaluation",
        message: `ClawBench agent finished for ${params.caseName}`,
        level: 1,
        auxiliary: {
          message: {
            value: String(agentResult.message ?? ""),
            type: "string",
          },
        },
      });

      const interception = await runtime.readInterception();
      const judge =
        interception && interception.intercepted
          ? await judgeClawBenchInterception({
              modelConfig: judgeConfig,
              judgeModelName,
              instruction: params.instruction,
              interception,
              judgeContext: params.judgeContext,
              rubric:
                process.env.EVAL_CLAWBENCH_JUDGE_RUBRIC === "strict"
                  ? "strict"
                  : "lenient",
            })
          : null;
      const success = Boolean(
        interception?.intercepted && judge?.match === true,
      );
      const runMeta = {
        test_case: params.caseName,
        task_id: params.taskId,
        corpus: params.corpus,
        instruction: params.instruction,
        metadata: params.metadata,
        agent_result: summarizeAgentResult(agentResult),
        intercepted: Boolean(interception?.intercepted),
        judge,
        pass: success,
        model: modelName,
        output_dir: runtime.runDir,
        debugUrl,
        sessionUrl,
      };
      await fs.writeFile(
        path.join(runtime.runDir, "run-meta.json"),
        JSON.stringify(runMeta, null, 2),
      );
      if (judge) {
        await fs.writeFile(
          path.join(
            runtime.runDir,
            judge.rubric === "strict" ? "judge.json" : "judge_llm.json",
          ),
          JSON.stringify(judge, null, 2),
        );
      }

      return {
        _success: success,
        intercepted: Boolean(interception?.intercepted),
        judge,
        artifactPath: runtime.runDir,
        caseName: params.caseName,
        taskId: params.taskId,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      await runtime
        .recordAgentMessage({
          type: "execute_error",
          source: "stagehand_agent",
          error: error instanceof Error ? error.message : String(error),
        })
        .catch(() => {});
      await fs
        .writeFile(
          path.join(runtime.runDir, "run-meta.json"),
          JSON.stringify(
            {
              test_case: params.caseName,
              task_id: params.taskId,
              corpus: params.corpus,
              instruction: params.instruction,
              metadata: params.metadata,
              intercepted: false,
              judge: null,
              pass: false,
              model: modelName,
              output_dir: runtime.runDir,
              debugUrl,
              sessionUrl,
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2,
          ),
        )
        .catch(() => {});
      return {
        _success: false,
        error: error instanceof Error ? error.message : String(error),
        artifactPath: runtime.runDir,
        caseName: params.caseName,
        taskId: params.taskId,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await emailCleanup?.();
    }
  },
);
