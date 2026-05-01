import { EvalsError } from "../errors.js";
import type { EvalInput } from "../types/evals.js";

export interface ExternalHarnessTaskPlan {
  dataset: "webvoyager" | "onlineMind2Web" | "webtailbench";
  taskId?: string;
  startUrl: string;
  instruction: string;
}

function readString(
  params: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function buildExternalHarnessTaskPlan(
  input: EvalInput,
): ExternalHarnessTaskPlan {
  const params = input.params ?? {};

  if (input.name === "agent/webvoyager") {
    const startUrl = readString(params, "web");
    const instruction = readString(params, "ques");
    if (!startUrl || !instruction) {
      throw new EvalsError(
        `Missing WebVoyager params for external harness: expected web and ques.`,
      );
    }
    return {
      dataset: "webvoyager",
      taskId: readString(params, "id"),
      startUrl,
      instruction,
    };
  }

  if (input.name === "agent/onlineMind2Web") {
    const startUrl = readString(params, "website");
    const instruction = readString(params, "confirmed_task");
    if (!startUrl || !instruction) {
      throw new EvalsError(
        `Missing onlineMind2Web params for external harness: expected website and confirmed_task.`,
      );
    }
    return {
      dataset: "onlineMind2Web",
      taskId: readString(params, "task_id"),
      startUrl,
      instruction,
    };
  }

  if (input.name === "agent/webtailbench") {
    const instruction = readString(params, "ques");
    if (!instruction) {
      throw new EvalsError(
        `Missing WebTailBench params for external harness: expected ques.`,
      );
    }
    return {
      dataset: "webtailbench",
      taskId: readString(params, "id"),
      startUrl: readString(params, "web") ?? "https://www.google.com",
      instruction,
    };
  }

  throw new EvalsError(
    `External harness "${input.name}" is not supported yet. Supported: agent/webvoyager, agent/onlineMind2Web, agent/webtailbench.`,
  );
}
