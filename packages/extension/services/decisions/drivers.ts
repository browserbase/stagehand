import type { WebMCPToolDescriptor } from "@browserbasehq/stagehand-protocol/types";
import { TimeoutError } from "../../errors.js";
import * as inference from "../../inference.js";
import type {
  ActDriver,
  ActRequest,
  CachedActionGuard,
  CompletionJudge,
  ExtractDriver,
  ObserveDriver,
} from "../drivers/types.js";
import { redactor } from "./args.js";
import { checkCachedAction } from "./cacheCheck.js";
import { runDecisionsExtract } from "./extract/index.js";
import type { JsonSchema } from "./extract/plan.js";
import { extractionCompleted } from "./extractCheck.js";
import { runDecisionsObserve } from "./observe.js";
import type { TraceEntry } from "./pick.js";
import { runDecisionsAct, type DecisionsActOutcome } from "./act/index.js";
import type { DecisionsConfig } from "./config.js";
import type { DecisionsToolDeps, ToolInput } from "./toolAct.js";
import { focusOutline, parseOutline } from "./tree.js";

const NAME = "decisions";
const DEFAULT_ACT_CONFIDENCE = 0.7;
const COMPLETION_THRESHOLD = 0.5;
const LIST_TOOLS_TIMEOUT_MS = 300;

export function decisionsActDriver(config: DecisionsConfig): ActDriver {
  const toolListings = new WeakMap<ActRequest, Promise<WebMCPToolDescriptor[]>>();
  const listTools = (request: ActRequest): Promise<WebMCPToolDescriptor[]> => {
    let listing = toolListings.get(request);
    if (!listing) {
      // Browsers without the WebMCP domain reject the enable call.
      listing = request.page.listWebMCPTools({ timeout: LIST_TOOLS_TIMEOUT_MS }).catch(() => []);
      toolListings.set(request, listing);
    }
    return listing;
  };
  const usesTools = (request: ActRequest): boolean =>
    config.tools === true && !request.snapshotOptions?.focusLocator;

  return {
    name: NAME,
    startsBeforeSettle: true,
    prepare(request) {
      if (usesTools(request)) void listTools(request);
    },
    async resolve(request) {
      const { instruction, variables, llm } = request;
      const redact = redactor(variables) ?? ((text: string) => text);
      const variableNames = Object.keys(variables ?? {});
      let usedArgumentLlm = false;

      const webmcp: DecisionsToolDeps | undefined = usesTools(request)
        ? {
            page: request.page,
            tools: listTools(request),
            fillArguments: async (tool) => {
              const response = await inference.toolArguments({
                instruction,
                tool,
                variableNames,
                generate: (input) => llm.generate(input),
              });
              llm.record(response);
              const required = Array.isArray(tool.inputSchema?.required)
                ? tool.inputSchema.required
                : [];
              const input = response.input;
              return input && required.every((name) => typeof name === "string" && name in input)
                ? (input as ToolInput)
                : null;
            },
          }
        : undefined;

      const outcome = await runDecisionsAct(config, {
        page: request.page,
        logger: request.logger,
        instruction,
        variables,
        snapshotOptions: request.snapshotOptions,
        ensureTimeRemaining: request.ensureTimeRemaining,
        openPageCount: request.openPageCount,
        settled: request.settled,
        ...(webmcp ? { webmcp } : {}),
        extractText: async (text) => {
          const response = await inference.actTextArgument({
            instruction: text,
            variableNames,
            generate: (input) => llm.generate(input),
          });
          llm.record(response);
          usedArgumentLlm = true;
          return response.text;
        },
        takeAction: (action) => request.runAction(action, { selfHeal: false }),
      }).catch((error: unknown): DecisionsActOutcome => {
        request.progress.throwIfStopped();
        if (error instanceof TimeoutError) throw error;
        return { kind: "fallback", reason: `decision_error:${messageOf(error)}` };
      });

      if (outcome.kind === "done") {
        return {
          kind: "resolved",
          result: outcome.result,
          path: outcome.viaTool
            ? outcome.viaTool.argumentLlm
              ? `${NAME}-tool+arg-llm`
              : `${NAME}-tool`
            : usedArgumentLlm
              ? `${NAME}+arg-llm`
              : NAME,
          cacheable: outcome.noCache !== true,
        };
      }

      const focusIds = config.focusFallback ? (outcome.focusIds ?? []) : [];
      return {
        kind: "abstained",
        reason: redact(outcome.reason),
        handoff: {
          priorActions: outcome.priorActions ?? [],
          cacheable: outcome.noCache !== true,
          ...(focusIds.length > 0
            ? { focus: (tree: string) => focusOutline(parseOutline(tree), focusIds) }
            : {}),
        },
      };
    },
  };
}

export function decisionsObserveDriver(config: DecisionsConfig): ObserveDriver {
  return {
    name: NAME,
    async resolve(request) {
      const outcome = await runDecisionsObserve(config, {
        page: request.page,
        logger: request.logger,
        instruction: request.instruction,
        variables: request.variables,
        snapshotOptions: request.snapshotOptions,
        ensureTimeRemaining: request.ensureTimeRemaining,
      }).catch((error: unknown) => {
        request.progress.throwIfStopped();
        if (error instanceof TimeoutError) throw error;
        return { kind: "fallback" as const, reason: `decision_error:${messageOf(error)}` };
      });
      if (outcome.kind === "done") return { kind: "resolved", actions: outcome.actions };
      const redact = redactor(request.variables) ?? ((text: string) => text);
      return { kind: "abstained", reason: redact(outcome.reason) };
    },
  };
}

export function decisionsExtractDriver(
  config: DecisionsConfig,
  options: { gateOnCompletion: boolean },
): ExtractDriver {
  return {
    name: NAME,
    async resolve(request) {
      if (request.screenshot) return { kind: "abstained", reason: "screenshot_extraction" };

      const outcome = await runDecisionsExtract(config, {
        logger: request.logger,
        instruction: request.instruction,
        schema: request.jsonSchema as JsonSchema,
        snap: {
          tree: request.snapshot.tree,
          xpathMap: {},
          nodes: parseOutline(request.snapshot.tree),
        },
        urlMap: request.snapshot.urlMap,
        ensureTimeRemaining: request.ensureTimeRemaining,
        gate: options.gateOnCompletion,
      }).catch((error: unknown) => {
        request.progress.throwIfStopped();
        if (error instanceof TimeoutError) throw error;
        return { kind: "fallback" as const, reason: `decision_error:${messageOf(error)}` };
      });
      if (outcome.kind === "fallback") return { kind: "abstained", reason: outcome.reason };

      const valid = request.schema.safeParse(outcome.data);
      return valid.success
        ? { kind: "resolved", data: valid.data }
        : { kind: "abstained", reason: "schema_mismatch" };
    },
  };
}

export function decisionsCompletionJudge(config: DecisionsConfig): CompletionJudge {
  return async (extracted, request) => {
    const trace: TraceEntry[] = [];
    const verdict = await extractionCompleted(
      {
        config,
        instruction: request.instruction,
        trace,
        threshold: COMPLETION_THRESHOLD,
        logger: request.logger,
        ensureTimeRemaining: request.ensureTimeRemaining,
      },
      extracted,
    );
    request.logger.info("Decisions extract completion", {
      category: "decisions",
      instruction: request.instruction,
      score: verdict.score,
      trace: JSON.stringify(trace),
    });
    return verdict.completed;
  };
}

export function decisionsCachedActionGuard(config: DecisionsConfig): CachedActionGuard {
  return {
    async check(action, request) {
      const redact = redactor(request.variables);
      const trace: TraceEntry[] = [];
      const verdict = await (async () => {
        const { combinedTree, combinedXpathMap } = await request.page.captureSnapshot(
          {},
          request.progress,
        );
        return await checkCachedAction(
          {
            config,
            instruction: request.instruction,
            trace,
            threshold: config.actConfidence ?? DEFAULT_ACT_CONFIDENCE,
            logger: request.logger,
            ensureTimeRemaining: request.ensureTimeRemaining,
            redact,
          },
          {
            tree: combinedTree,
            xpathMap: combinedXpathMap as Record<string, string>,
            nodes: parseOutline(combinedTree),
          },
          action,
        );
      })().catch((error: unknown) => {
        request.progress.throwIfStopped();
        if (error instanceof TimeoutError) throw error;
        return undefined;
      });
      if (!verdict) return { verdict: "ok" };

      request.logger.info("Decisions cache check", {
        category: "decisions",
        instruction: request.instruction,
        verdict: verdict.verdict,
        trace: JSON.stringify(trace),
      });
      if (verdict.verdict !== "stale") return { verdict: "ok" };
      return {
        verdict: "stale",
        detail: `selector now resolves to "${(redact ?? ((text: string) => text))(verdict.found ?? "")}" (match ${verdict.score})`,
      };
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
