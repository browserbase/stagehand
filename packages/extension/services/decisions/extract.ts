import { type TableReader, projectTable } from "./tableProjection.js";
import { tableContext } from "./tableEvidence.js";
import type { DocumentExtraction } from "./documentExtraction.js";
import { extractLinkDestination } from "./linkDestination.js";
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
import { requestedHeadings, snapshotHeadingNames } from "./headingProjection.js";
import { scalarReader } from "./scalarReader.js";
import type { DecisionsConfig } from "./config.js";

type ExtractionOutcome = { usage: StagehandResultUsage } & (
  | { kind: "done"; data: JsonValue }
  | { kind: "fallback"; reason: string; linkEvidence?: string }
);

export async function runDecisionsExtract(
  config: DecisionsConfig,
  deps: {
    instruction: string;
    schema: StagehandExtractParams["schema"];
    snapshot: Awaited<ReturnType<Page["captureSnapshot"]>>;
    tableReader?: TableReader;
    document?: DocumentExtraction;
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
    // Copy rules with multiple text boundaries can require the ordinary model.
    // Decision-only callers keep their existing mapping path.
    const document = deps.document;
    const table = document?.table;
    const tables = table
      ? (deps.snapshot.combinedTree.match(/^ *\[\d+-\d+\] table\b/gim)?.length ?? 0)
      : 0;
    if (table && (tables === 1 || (tables > 1 && table.scope.years))) {
      const evidence = await document.readTable(table.scope);
      const context = evidence && tableContext(deps.snapshot, evidence);
      if (evidence && context) {
        const result = await projectTable(
          counted,
          deps.instruction,
          table,
          evidence,
          context,
          deps.tableReader,
        );
        deps.progress.throwIfStopped();
        const schema = z.fromJSONSchema(deps.schema as Parameters<typeof z.fromJSONSchema>[0]);
        if (result && schema.safeParse(result).success) {
          deps.logger.info("Decisions table projection accepted", {
            category: "decisions",
            decisionRequests: requests,
          });
          return { kind: "done", data: result, usage };
        }
      }
      throw new Error("unresolved table projection");
    }
    if (
      document?.destination &&
      deps.snapshot.perFrame?.length === 1 &&
      !/^ *\[\d+-\d+\] (?:iframe|frame|embeddedobject)\b/im.test(deps.snapshot.combinedTree)
    ) {
      const result = await extractLinkDestination(
        document.destination,
        deps.snapshot,
        document.readLinks,
      );
      deps.progress.throwIfStopped();
      if ("evidence" in result)
        return fallback("link destination needs interpretation", result.evidence);
      deps.logger.info("Decisions link destination accepted", {
        category: "decisions",
        decisionRequests: 0,
      });
      return { kind: "done", data: result.data, usage };
    }
    const request = requestedHeadings(deps.instruction, deps.schema as JsonSchema);
    if (request) {
      if (!document) throw new Error("unsupported heading scope");
      const names = snapshotHeadingNames(deps.snapshot, request.level);
      if (names) {
        const values = await document.readHeadings(request);
        deps.progress.throwIfStopped();
        if (
          Array.isArray(values) &&
          values.length === names.length &&
          values.every(
            (value, i) => typeof value === "string" && value.replace(/\s+/gu, " ") === names[i],
          )
        ) {
          deps.logger.info("Decisions heading projection accepted", {
            category: "decisions",
            decisionRequests: 0,
          });
          // Accessibility names collapse whitespace. Copy the rendered text after matching it.
          return { kind: "done", data: { [request.field]: values }, usage };
        }
      }
      throw new Error("incomplete heading evidence");
    }
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
    return fallback(error instanceof Error ? error.message : String(error));
  } finally {
    usage.inferenceTimeMs = Math.round(performance.now() - started);
    deps.logger.debug("Decisions extraction trace", {
      category: "decisions",
      trace: JSON.stringify(trace),
    });
  }

  function fallback(reason: string, linkEvidence?: string): ExtractionOutcome {
    deps.logger.info("Decisions extraction fell back to the LLM", {
      category: "decisions",
      reason,
      decisionRequests: requests,
    });
    return { kind: "fallback", reason, usage, linkEvidence };
  }
}
