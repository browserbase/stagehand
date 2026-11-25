import type {
  ActResultData,
  Variables,
  WebMCPToolDescriptor,
} from "@browserbasehq/stagehand-protocol/types";
import type { Page } from "../../understudy/page.js";
import { redactor, substituteVariables } from "./args.js";
import type { TraceEntry } from "./pick.js";
import type { JsonValue } from "./typesafeClient.js";

const RESULT_TIMEOUT_MS = 30_000;
const RESULT_MESSAGE_CHARS = 2_000;

export type ToolInput = Record<string, JsonValue>;

export type DecisionsToolDeps = {
  page: Pick<Page, "invokeWebMCPTool" | "waitForWebMCPInvocationResult" | "cancelWebMCPInvocation">;
  tools: Promise<WebMCPToolDescriptor[]>;
  fillArguments?: (tool: WebMCPToolDescriptor) => Promise<ToolInput | null>;
};

export async function invokeTool(
  deps: DecisionsToolDeps,
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
  const response = await deps.page
    .waitForWebMCPInvocationResult(invocation.invocationId, { timeout: RESULT_TIMEOUT_MS })
    .catch((error: unknown) => {
      void deps.page.cancelWebMCPInvocation(invocation.invocationId).catch(() => {});
      const text = error instanceof Error ? error.message : String(error);
      return {
        status: "Error" as const,
        output: undefined,
        errorText: `${text}${text.endsWith(".") ? "" : "."} The tool may still have run.`,
        exception: undefined,
      };
    });
  trace.push({
    node: "tool_invoke",
    ms: Math.round(performance.now() - started),
    tool: tool.name,
    status: response.status,
  });

  const success = response.status === "Completed";
  const redact = redactor(variables) ?? ((text: string) => text);
  const thrown = response.exception?.description;
  const detail = success
    ? response.output === undefined
      ? ""
      : `: ${redact(JSON.stringify(response.output)).slice(0, RESULT_MESSAGE_CHARS)}`
    : `: ${redact(response.errorText ?? (typeof thrown === "string" ? thrown : response.status)).slice(0, RESULT_MESSAGE_CHARS)}`;
  return {
    success,
    message: `${success ? "Invoked" : "Failed to invoke"} WebMCP tool ${tool.name}${detail}`,
    actionDescription: instruction,
    actions: [
      {
        selector: `webmcp:${tool.name}`,
        description: tool.description,
        method: "webmcp",
        arguments: [JSON.stringify(input)],
      },
    ],
  };
}

function resolveVariables(input: ToolInput, variables: Variables | undefined): ToolInput {
  const resolve = (value: JsonValue): JsonValue => {
    if (typeof value === "string") return substituteVariables(value, variables);
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolve(child)]));
    }
    return value;
  };
  return Object.fromEntries(Object.entries(input).map(([name, value]) => [name, resolve(value)]));
}
