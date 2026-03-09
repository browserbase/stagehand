import type {
  CloseAgentArgs,
  ParallelArgs,
  SpawnExtraAgentArgs,
  UpdatePlanArgs,
  ViewImageOrDocumentArgs,
  WaitArgs,
} from "./protocol.js";

export function createDeferredToolStubs(input: {
  onUpdatePlan?: (args: UpdatePlanArgs) => Promise<unknown> | unknown;
}) {
  return {
    functions_update_plan: async (args: UpdatePlanArgs) =>
      input.onUpdatePlan
        ? await input.onUpdatePlan(args)
        : {
            ok: true,
            explanation: args.explanation ?? null,
            plan: args.plan,
          },

    // These handlers intentionally return stable stub payloads now so the
    // top-level agent can expose the full tool contract before the host
    // integrations (OCR, async wait registry, dynamic agent pool, parallel
    // scheduling) are implemented.
    functions_view_image_or_document: async (
      args: ViewImageOrDocumentArgs,
    ) => ({
      ok: false,
      deferred: true,
      message:
        "functions_view_image_or_document is stubbed until a host image/document adapter is wired in.",
      input: args,
    }),

    functions_wait: async (args: WaitArgs) => ({
      ok: false,
      deferred: true,
      message:
        "functions_wait is stubbed until the runtime tracks asynchronous task ids beyond inline tool execution.",
      input: args,
    }),

    functions_spawn_agent: async (args: SpawnExtraAgentArgs) => ({
      ok: false,
      deferred: true,
      message:
        "functions_spawn_agent is stubbed until dynamic extra subagents are supported.",
      input: args,
    }),

    functions_close_agent: async (args: CloseAgentArgs) => ({
      ok: false,
      deferred: true,
      message:
        "functions_close_agent is stubbed until dynamic extra subagents are supported.",
      input: args,
    }),

    multi_tool_use_parallel: async (args: ParallelArgs) => ({
      ok: false,
      deferred: true,
      message:
        "multi_tool_use_parallel is stubbed until the runtime can safely schedule disjoint tool calls.",
      input: args,
    }),
  };
}
