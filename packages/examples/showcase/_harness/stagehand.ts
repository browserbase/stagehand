import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import type { z } from "zod/v4";
import { costUsd } from "./pricing.ts";
import type { RunMetrics, TimelineStep } from "./results.ts";
import { MODEL, requireEnv, sessionSettings, stagehandModel } from "./session.ts";
import type { ShowcaseTask, Workflow } from "./task.ts";

type Traced = "act" | "extract" | "observe";
const TRACED = new Set<string>(["act", "extract", "observe"]);

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};

type TracedResult = {
  data?: unknown;
  metadata?: { usage?: Usage; cache?: { status?: string; missReason?: string } };
};

export type StagehandRun = {
  metrics: RunMetrics;
  sessionId: string | undefined;
  output: unknown;
  steps: Array<TimelineStep & { startedAt: number }>;
};

// Records each act/extract/observe call so the website can draw a timeline
// that seeks the recording, without the cookbook code knowing about it.
function trace(stagehand: Stagehand, steps: StagehandRun["steps"], origin: number): Stagehand {
  return new Proxy(stagehand, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      if (typeof prop !== "string" || !TRACED.has(prop)) return value.bind(target);
      return async (...args: unknown[]) => {
        const startedAt = Date.now();
        const result = (await value.apply(target, args)) as TracedResult;
        const usage = result.metadata?.usage ?? {};
        steps.push({
          startedAt,
          t: (startedAt - origin) / 1000,
          durationMs: Date.now() - startedAt,
          kind: prop as Traced,
          instruction: typeof args[0] === "string" ? args[0] : JSON.stringify(args[0]),
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          cachedInputTokens: usage.cachedInputTokens ?? 0,
          reasoningTokens: usage.reasoningTokens ?? 0,
          cache: result.metadata?.cache?.status ?? "DISABLED",
          ...(result.metadata?.cache?.missReason
            ? { cacheMissReason: result.metadata.cache.missReason }
            : {}),
        });
        return result;
      };
    },
  });
}

export async function runStagehand<Schema extends z.ZodType>(
  workflow: Workflow<Schema>,
  task: ShowcaseTask<Schema>,
  options: { cache: boolean },
): Promise<StagehandRun> {
  const env = requireEnv();
  const browser = await browserbase.launch({
    apiKey: env.BROWSERBASE_API_KEY,
    ...sessionSettings(task),
  });
  const steps: StagehandRun["steps"] = [];
  let output: unknown;
  let success = false;
  let error: string | undefined;
  const started = Date.now();

  try {
    const stagehand = await Stagehand.create({
      browser,
      model: stagehandModel(env.MODEL_API_KEY),
      cache: options.cache ? { threshold: 1 } : false,
      logging: { level: process.env.SH_LOG === "debug" ? "debug" : "warn" },
    });
    try {
      const [page] = await browser.context.pages();
      if (!page) throw new Error("Browserbase session has no page");
      output = await workflow.run(trace(stagehand, steps, started), page);
      success = task.check(workflow.schema.parse(output));
    } finally {
      await stagehand.close();
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    await browser.close();
  }

  const usage = steps.reduce(
    (sum, step) => ({
      inputTokens: sum.inputTokens + step.inputTokens,
      outputTokens: sum.outputTokens + step.outputTokens,
      cachedInputTokens: sum.cachedInputTokens + step.cachedInputTokens,
      cacheWriteInputTokens: sum.cacheWriteInputTokens,
      reasoningTokens: sum.reasoningTokens + step.reasoningTokens,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningTokens: 0,
    },
  );

  return {
    metrics: {
      ...usage,
      costUsd: costUsd(MODEL, usage),
      durationMs: Date.now() - started,
      llmCalls: steps.filter((step) => step.inputTokens > 0).length,
      success,
      ...(error ? { error } : {}),
    },
    sessionId: browser.sessionId,
    output,
    steps,
  };
}
