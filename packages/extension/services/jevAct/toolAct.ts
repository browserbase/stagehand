import type {
  ActResultData,
  Variables,
  WebMCPToolDescriptor,
} from "@browserbasehq/stagehand-protocol/types";
import type { StagehandLogger } from "../../logger.js";
import type { Page } from "../../understudy/page.js";
import { redactor, substituteVariables } from "./args.js";
import type { AskContext } from "./pick.js";
import type { JevActConfig } from "./pipeline.js";
import { selectTool } from "./tools.js";
import type { JsonValue } from "./typesafeClient.js";

/**
 * act() through a WebMCP tool: when the page registers tools and Jev is sure
 * one of them IS the request, invoke it instead of finding something to click.
 * Every doubt returns "skip" and act() carries on exactly as before.
 */

/** Tools registered at load are reported within the quiet window; none at all costs this much. */
const LIST_TOOLS_TIMEOUT_MS = 300;
const RESULT_TIMEOUT_MS = 30_000;
const RESULT_MESSAGE_CHARS = 2_000;

export type JevToolActDeps = {
  page: Pick<Page, "listWebMCPTools" | "invokeWebMCPTool" | "waitForWebMCPInvocationResult">;
  logger: StagehandLogger;
  instruction: string;
  variables?: Variables;
  ensureTimeRemaining: () => void;
  /** Argument-only LLM call for the chosen tool; null when it cannot fill them. */
  fillArguments?: (tool: WebMCPToolDescriptor) => Promise<Record<string, JsonValue> | null>;
};

export type JevToolActOutcome =
  | { kind: "done"; result: ActResultData; usedArgumentLlm: boolean }
  | { kind: "skip"; reason: string };

export async function runJevToolAct(
  config: JevActConfig,
  deps: JevToolActDeps,
): Promise<JevToolActOutcome> {
  const tools = await deps.page
    .listWebMCPTools({ timeout: LIST_TOOLS_TIMEOUT_MS })
    // Browsers without the WebMCP domain reject the enable call.
    .catch(() => []);
  if (tools.length === 0) return { kind: "skip", reason: "no_tools" };

  const trace: AskContext["trace"] = [];
  const redact = redactor(deps.variables);
  const ctx: AskContext = {
    config,
    instruction: deps.instruction,
    trace,
    threshold: config.actConfidence ?? 0.7,
    logger: deps.logger,
    ensureTimeRemaining: deps.ensureTimeRemaining,
    ...(redact ? { redact } : {}),
  };
  const finish = (outcome: JevToolActOutcome): JevToolActOutcome => {
    deps.logger.info("Jev tool selection finished", {
      category: "jev",
      instruction: deps.instruction,
      outcome: outcome.kind,
      reason: outcome.kind === "skip" ? outcome.reason : "",
      trace: redact ? redact(JSON.stringify(trace)) : JSON.stringify(trace),
    });
    return outcome;
  };

  const selection = await selectTool(ctx, tools);
  if (selection.kind === "skip") return finish(selection);

  const { tool } = selection;
  let input = selection.input;
  let usedArgumentLlm = false;
  if (!input && deps.fillArguments && config.argumentLlm !== false) {
    usedArgumentLlm = true;
    const started = performance.now();
    input = (await deps.fillArguments(tool).catch(() => null)) ?? undefined;
    trace.push({ node: "tool_arguments_llm", ms: Math.round(performance.now() - started) });
  }
  if (!input) return finish({ kind: "skip", reason: "arguments_not_filled" });

  deps.ensureTimeRemaining();
  const resolved = resolveVariables(input, deps.variables);
  const invocation = await deps.page.invokeWebMCPTool(tool.frameId, tool.name, {
    input: resolved,
  });
  // Past this point the tool is running: a failure to hear back is a failed
  // act, never a reason to go and click through the UI as well.
  const response = await deps.page
    .waitForWebMCPInvocationResult(invocation.invocationId, { timeout: RESULT_TIMEOUT_MS })
    .catch((error: unknown) => ({
      status: "Error" as const,
      output: undefined,
      errorText: error instanceof Error ? error.message : String(error),
    }));
  trace.push({ node: "tool_invoke", tool: tool.name, status: response.status });

  const success = response.status === "Completed";
  const detail = success
    ? response.output === undefined
      ? ""
      : `: ${JSON.stringify(response.output).slice(0, RESULT_MESSAGE_CHARS)}`
    : `: ${response.errorText ?? response.status}`;
  return finish({
    kind: "done",
    usedArgumentLlm,
    result: {
      success,
      message: `${success ? "Invoked" : "Failed to invoke"} WebMCP tool ${tool.name}${detail}`,
      actionDescription: deps.instruction,
      actions: [
        {
          selector: `webmcp:${tool.name}`,
          description: tool.description,
          method: "webmcp",
          // The placeholders, not the resolved values: results are logged and returned.
          arguments: [JSON.stringify(input)],
        },
      ],
    },
  });
}

function resolveVariables(
  input: Record<string, JsonValue>,
  variables: Variables | undefined,
): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(input).map(([name, value]) => [
      name,
      typeof value === "string" ? substituteVariables(value, variables) : value,
    ]),
  );
}
