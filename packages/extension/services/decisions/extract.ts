import type { JsonValue } from "./providers.js";
import { z } from "zod/v4";
import type {
  StagehandExtractParams,
  StagehandResultUsage,
} from "@browserbasehq/stagehand-protocol/types";
import type { StagehandLogger } from "../../logger.js";
import type { Page } from "../../understudy/page.js";
import type { Progress } from "../../understudy/progress.js";
import { zeroStagehandResultUsage } from "../resultUsage.js";
import { mapCopyExtract, type JsonSchema } from "./mapCopy.js";
import { scalarReader } from "./scalarReader.js";
import type { DecisionsConfig } from "./config.js";

type ExtractionOutcome = { usage: StagehandResultUsage } & (
  | { kind: "done"; data: JsonValue }
  | { kind: "fallback"; reason: string }
);

export async function runDecisionsExtract(
  config: DecisionsConfig,
  deps: {
    instruction: string;
    schema: StagehandExtractParams["schema"];
    snapshot: Awaited<ReturnType<Page["captureSnapshot"]>>;
    progress: Progress;
    logger: StagehandLogger;
  },
): Promise<ExtractionOutcome> {
  const started = performance.now();
  const usage = zeroStagehandResultUsage();
  let requests = 0;
  const trace: Parameters<typeof mapCopyExtract>[1]["trace"] = [];
  const counted: DecisionsConfig = {
    ...config,
    recordDecisionUsage: (tokens) => {
      requests++;
      usage.inputTokens += tokens.inputTokens;
      usage.outputTokens += tokens.outputTokens;
      config.recordDecisionUsage?.(tokens);
    },
  };
  try {
    const outcome = await deps.progress.run("mapping extraction evidence", () =>
      mapCopyExtract(counted, {
        instruction: deps.instruction,
        schema: deps.schema as JsonSchema,
        tree: deps.snapshot.combinedTree,
        urlMap: deps.snapshot.combinedUrlMap ?? {},
        reader: scalarReader(counted, deps.progress),
        trace,
      }),
    );
    deps.progress.throwIfStopped();
    const schema = z.fromJSONSchema(deps.schema as Parameters<typeof z.fromJSONSchema>[0]);
    const valid = schema.safeParse(outcome.data);
    const problems = outcome.verdict.problems;
    if (!valid.success || problems.length)
      throw new Error(valid.success ? problems.join(",") : "schema_mismatch");
    deps.logger.info("Decisions extraction accepted", {
      category: "decisions",
      decisionRequests: requests,
    });
    return { kind: "done", data: z.json().parse(valid.data), usage };
  } catch (error) {
    deps.progress.throwIfStopped();
    const reason = error instanceof Error ? error.message : String(error);
    deps.logger.info("Decisions extraction fell back to the LLM", {
      category: "decisions",
      reason,
      decisionRequests: requests,
    });
    return { kind: "fallback", reason, usage };
  } finally {
    usage.inferenceTimeMs = Math.round(performance.now() - started);
    deps.logger.debug("Decisions extraction trace", {
      category: "decisions",
      trace: JSON.stringify(trace),
    });
  }
}
