import { EvalsError } from "../errors.js";
import type { EvalInput } from "../types/evals.js";

export interface ExternalHarnessTaskPlan {
  dataset: "webvoyager" | "onlineMind2Web" | "webtailbench" | "hardbenchmark" | "odysseysbench";
  taskId?: string;
  startUrl: string;
  instruction: string;
}

function readString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function buildExternalHarnessTaskPlan(input: EvalInput): ExternalHarnessTaskPlan {
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

  if (input.name === "agent/webtailbench" || input.name === "agent/hardbenchmark") {
    const instruction = readString(params, "ques");
    if (!instruction) {
      throw new EvalsError(`Missing ${input.name} params for external harness: expected ques.`);
    }
    return {
      dataset: input.name === "agent/hardbenchmark" ? "hardbenchmark" : "webtailbench",
      taskId: readString(params, "id"),
      startUrl: readString(params, "web") ?? "https://www.google.com",
      instruction,
    };
  }

  if (input.name === "agent/odysseysbench") {
    const instruction = readString(params, "confirmed_task");
    if (!instruction) {
      throw new EvalsError(
        `Missing OdysseysBench params for external harness: expected confirmed_task.`,
      );
    }
    return {
      dataset: "odysseysbench",
      taskId: readString(params, "task_id"),
      startUrl: readString(params, "website") ?? "https://www.google.com",
      instruction,
    };
  }

  throw new EvalsError(
    `External harness "${input.name}" is not supported yet. Supported: agent/webvoyager, agent/onlineMind2Web, agent/webtailbench, agent/odysseysbench.`,
  );
}

/**
 * Dataset-specific prompt constraints carried over from the retired
 * first-party suite modules. OnlineMind2Web's site-scoping constraint is a
 * validity requirement: without it, tasks are passable by answering from a
 * search engine instead of operating the assigned site.
 */
export function datasetPromptGuidance(dataset: string): string | undefined {
  switch (dataset) {
    case "onlineMind2Web":
      return "ALWAYS OPERATE WITHIN THE PAGE OPENED BY THE USER, WHICHEVER TASK YOU ARE ATTEMPTING TO COMPLETE CAN BE ACCOMPLISHED WITHIN THE PAGE.";
    case "webtailbench":
    case "hardbenchmark":
    case "odysseysbench":
      return "You will need to navigate to the appropriate website to complete the task.";
    default:
      return undefined;
  }
}
