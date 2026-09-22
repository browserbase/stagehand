import type {
  ActResultData,
  Variables,
  WebMCPToolDescriptor,
} from "@browserbasehq/stagehand-protocol/types";
import type { Page } from "../../understudy/page.js";
import { substituteVariables } from "./args.js";
import type { TraceEntry } from "./pick.js";
import type { JsonValue } from "./typesafeClient.js";

/**
 * act() through a WebMCP tool: when the page registers tools and Jev is sure
 * one of them IS the request, the tool is invoked instead of finding something
 * to click. The choice itself rides in the act pipeline's intent request.
 */

const RESULT_TIMEOUT_MS = 30_000;
const RESULT_MESSAGE_CHARS = 2_000;

export type ToolInput = Record<string, JsonValue>;

export type JevToolDeps = {
  page: Pick<Page, "invokeWebMCPTool" | "waitForWebMCPInvocationResult">;
  /**
   * The page's tools. A promise, so the listing overlaps whatever the caller
   * was already waiting for; empty on browsers without the WebMCP domain.
   */
  tools: Promise<WebMCPToolDescriptor[]>;
  /** Argument-only LLM call for one tool; null when it cannot fill them. */
  fillArguments?: (tool: WebMCPToolDescriptor) => Promise<ToolInput | null>;
};

export async function invokeTool(
  deps: JevToolDeps,
  instruction: string,
  variables: Variables | undefined,
  tool: WebMCPToolDescriptor,
  input: ToolInput,
  trace: TraceEntry[],
): Promise<ActResultData> {
  const started = performance.now();
  const invocation = await deps.page.invokeWebMCPTool(tool.frameId, tool.name, {
    input: resolveVariables(input, variables),
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
  trace.push({
    node: "tool_invoke",
    ms: Math.round(performance.now() - started),
    tool: tool.name,
    status: response.status,
  });

  const success = response.status === "Completed";
  const detail = success
    ? response.output === undefined
      ? ""
      : `: ${JSON.stringify(response.output).slice(0, RESULT_MESSAGE_CHARS)}`
    : `: ${response.errorText ?? response.status}`;
  return {
    success,
    message: `${success ? "Invoked" : "Failed to invoke"} WebMCP tool ${tool.name}${detail}`,
    actionDescription: instruction,
    actions: [
      {
        selector: `webmcp:${tool.name}`,
        description: tool.description,
        method: "webmcp",
        // The placeholders, not the resolved values: results are logged and returned.
        arguments: [JSON.stringify(input)],
      },
    ],
  };
}

function resolveVariables(input: ToolInput, variables: Variables | undefined): ToolInput {
  return Object.fromEntries(
    Object.entries(input).map(([name, value]) => [
      name,
      typeof value === "string" ? substituteVariables(value, variables) : value,
    ]),
  );
}
