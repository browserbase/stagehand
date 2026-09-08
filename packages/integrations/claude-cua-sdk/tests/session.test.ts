import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_BROWSER_TOOLSET_TYPE,
  buildBrowserToolsetDeclaration,
  buildClaudeCuaTranscript,
  compressTranscriptImages,
  isBrowserMemberEnabled,
  normalizeClaudeCuaModel,
  runClaudeCuaSession,
  type CuaApiMessage,
  type CuaMessagesClient,
  type CuaToolExecutor,
} from "../src/index.js";

const logger = { log: () => {}, warn: () => {}, error: () => {} };

function scriptedClient(responses: CuaApiMessage[]): CuaMessagesClient & {
  requests: Array<Record<string, unknown>>;
} {
  const requests: Array<Record<string, unknown>> = [];
  return {
    requests,
    create: async (params) => {
      requests.push(structuredClone(params));
      const next = responses.shift();
      if (!next) throw new Error("scripted client ran out of responses");
      return next;
    },
  };
}

function recordingExecutor(
  impl: (
    member: string,
    input: Record<string, unknown>,
  ) => Promise<{ content: string | never[]; isError?: boolean }> = async (member) => ({
    content: `${member} ok`,
  }),
): CuaToolExecutor & { calls: Array<{ member: string; input: Record<string, unknown> }> } {
  const calls: Array<{ member: string; input: Record<string, unknown> }> = [];
  return {
    calls,
    execute: async (member, input) => {
      calls.push({ member, input });
      return impl(member, input);
    },
  };
}

const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({
  type: "tool_use",
  id,
  name,
  toolset_name: "browser",
  input,
});

describe("Browser Use toolset declaration", () => {
  it("declares the fixed-member toolset with javascript_exec enabled by default", () => {
    expect(buildBrowserToolsetDeclaration()).toEqual({
      type: ANTHROPIC_BROWSER_TOOLSET_TYPE,
      configs: { javascript_exec: { enabled: true } },
    });
    expect(buildBrowserToolsetDeclaration({ file_upload: { enabled: true } })).toEqual({
      type: "browser_toolset_20260801",
      configs: { javascript_exec: { enabled: true }, file_upload: { enabled: true } },
    });
    expect(
      buildBrowserToolsetDeclaration({ read_console: { defer_loading: true, enabled: false } }),
    ).toEqual({
      type: "browser_toolset_20260801",
      configs: {
        javascript_exec: { enabled: true },
        read_console: { defer_loading: true, enabled: false },
      },
    });
    expect(isBrowserMemberEnabled("javascript_exec")).toBe(true);
    expect(isBrowserMemberEnabled("read_console")).toBe(false);
    expect(isBrowserMemberEnabled("navigate")).toBe(true);
    expect(isBrowserMemberEnabled("navigate", { navigate: { enabled: false } })).toBe(false);
  });

  it("normalizes provider-prefixed model ids", () => {
    expect(normalizeClaudeCuaModel("anthropic/claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(normalizeClaudeCuaModel("claude-sonnet-5")).toBe("claude-sonnet-5");
  });
});

describe("runClaudeCuaSession", () => {
  it("threads tool_use → tool_result with toolset_name, captures thinking and sums usage", async () => {
    const client = scriptedClient([
      {
        content: [
          { type: "thinking", thinking: "Need to open the page first.", signature: "sig" },
          { type: "text", text: "Opening the site." },
          toolUse("tu_1", "navigate", { url: "https://example.com" }),
        ],
        stop_reason: "tool_use",
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 400,
          cache_creation_input_tokens: 50,
        },
      },
      {
        content: [{ type: "text", text: 'EVAL_RESULT: {"success":true}' }],
        stop_reason: "end_turn",
        usage: { input_tokens: 30, output_tokens: 10 },
      },
    ]);
    const tools = recordingExecutor();

    const result = await runClaudeCuaSession({
      prompt: "do the task",
      model: "anthropic/claude-sonnet-5",
      logger,
      maxTurns: 10,
      tools,
      systemPrompt: "system rules",
      thinking: { type: "adaptive", effort: "medium" },
      client,
    });

    expect(result.status).toBe("completed");
    expect(result.stopReason).toBe("end_turn");
    expect(result.finalMessage).toBe('EVAL_RESULT: {"success":true}');
    expect(result.turns).toBe(2);
    expect(result.toolCalls).toBe(1);
    expect(result.tokenUsage).toEqual({
      input: 130,
      output: 30,
      cache_read: 400,
      cache_creation: 50,
      total: 610,
    });
    expect(tools.calls).toEqual([{ member: "navigate", input: { url: "https://example.com" } }]);

    // Request shape: system, toolset declaration, adaptive thinking + effort, model stripped.
    expect(client.requests[0]).toMatchObject({
      model: "claude-sonnet-5",
      system: "system rules",
      tools: [
        { type: "browser_toolset_20260801", configs: { javascript_exec: { enabled: true } } },
      ],
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
    });
    // Second request echoes the assistant turn verbatim (thinking + toolset_name) and threads the result.
    const second = client.requests[1]!.messages as Array<{ role: string; content: unknown }>;
    expect(second).toHaveLength(3);
    expect(second[1]).toMatchObject({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Need to open the page first.", signature: "sig" },
        { type: "text" },
        { type: "tool_use", toolset_name: "browser" },
      ],
    });
    expect(second[2]).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tu_1",
          toolset_name: "browser",
          content: "navigate ok",
        },
      ],
    });

    expect(result.events.map((event) => event.type)).toEqual([
      "assistant",
      "tool_use",
      "tool_result",
      "assistant",
    ]);
    expect(buildClaudeCuaTranscript(result.events)).toContain(
      "<thinking>\nNeed to open the page first.\n</thinking>",
    );
    expect(buildClaudeCuaTranscript(result.events)).toContain(
      '<tool_use name="navigate">{"url":"https://example.com"}</tool_use>',
    );
  });

  it("uses adaptive summarized thinking at the contract default effort", async () => {
    const client = scriptedClient([
      { content: [{ type: "text", text: "done" }], stop_reason: "end_turn", usage: {} },
    ]);
    await runClaudeCuaSession({
      prompt: "p",
      model: "claude-sonnet-5",
      logger,
      maxTurns: 1,
      tools: recordingExecutor(),
      client,
    });
    expect(client.requests[0]).toMatchObject({
      max_tokens: 16000,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "xhigh" },
    });
  });

  it("halts the rest of a turn after a failed member and marks is_error", async () => {
    const client = scriptedClient([
      {
        content: [
          toolUse("tu_1", "left_click", { target: { type: "ref", ref: "ref_9" } }),
          toolUse("tu_2", "screenshot", {}),
          { type: "tool_use", id: "tu_3", name: "not_a_tool", input: {} },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      { content: [{ type: "text", text: "done" }], stop_reason: "end_turn", usage: {} },
    ]);
    const tools = recordingExecutor(async (member) =>
      member === "left_click" ? { content: "Error: stale ref", isError: true } : { content: "ok" },
    );

    const result = await runClaudeCuaSession({
      prompt: "p",
      model: "claude-sonnet-5",
      logger,
      maxTurns: 5,
      tools,
      client,
    });

    expect(tools.calls.map((call) => call.member)).toEqual(["left_click"]);
    const results = (client.requests[1]!.messages as Array<{ content: unknown }>)[2]!
      .content as Array<Record<string, unknown>>;
    expect(results).toEqual([
      {
        type: "tool_result",
        tool_use_id: "tu_1",
        toolset_name: "browser",
        content: "Error: stale ref",
        is_error: true,
      },
      {
        type: "tool_result",
        tool_use_id: "tu_2",
        toolset_name: "browser",
        content: "Not executed: an earlier action in this turn failed.",
        is_error: true,
      },
      {
        type: "tool_result",
        tool_use_id: "tu_3",
        content: 'Error: unknown tool "not_a_tool". Only browser toolset members are available.',
        is_error: true,
      },
    ]);
    expect(result.status).toBe("completed");
    expect(result.toolCalls).toBe(3);
  });

  it("halts browser members after an unknown tool error in the same turn", async () => {
    const client = scriptedClient([
      {
        content: [
          { type: "tool_use", id: "unknown", name: "not_a_tool", input: {} },
          toolUse("later", "navigate", { url: "https://example.com" }),
        ],
        stop_reason: "tool_use",
      },
      { content: [{ type: "text", text: "done" }], stop_reason: "end_turn" },
    ]);
    const tools = recordingExecutor();
    const result = await runClaudeCuaSession({
      prompt: "p",
      model: "claude-sonnet-5",
      logger,
      maxTurns: 2,
      tools,
      client,
    });
    expect(tools.calls).toHaveLength(0);
    expect(result.events.filter((event) => event.type === "tool_result").at(-1)).toMatchObject({
      isError: true,
      content: "Not executed: an earlier action in this turn failed.",
    });
  });

  it("stops with max_turns when the budget runs out", async () => {
    const responses: CuaApiMessage[] = Array.from({ length: 3 }, (_, index) => ({
      content: [toolUse(`tu_${index}`, "screenshot", {})],
      stop_reason: "tool_use",
      usage: { input_tokens: 5, output_tokens: 5 },
    }));
    const client = scriptedClient(responses);
    const result = await runClaudeCuaSession({
      prompt: "p",
      model: "claude-sonnet-5",
      logger,
      maxTurns: 2,
      tools: recordingExecutor(),
      client,
    });
    expect(result.status).toBe("max_turns");
    expect(result.turns).toBe(2);
    expect(client.requests).toHaveLength(2);
    expect(result.finalMessage).toBe("");
  });

  it("reports refusals and request errors as sdk_error", async () => {
    const refusing = scriptedClient([
      {
        content: [],
        stop_reason: "refusal",
        stop_details: { category: "cyber", explanation: "nope" },
        usage: { input_tokens: 5, output_tokens: 0 },
      },
    ]);
    const refused = await runClaudeCuaSession({
      prompt: "p",
      model: "claude-sonnet-5",
      logger,
      maxTurns: 3,
      tools: recordingExecutor(),
      client: refusing,
    });
    expect(refused.status).toBe("sdk_error");
    expect(refused.stopReason).toContain("category: cyber");
    expect(refused.tokenUsage.input).toBe(5);

    const failing: CuaMessagesClient = {
      create: async () => {
        throw new Error("429 rate limited");
      },
    };
    const failed = await runClaudeCuaSession({
      prompt: "p",
      model: "claude-sonnet-5",
      logger,
      maxTurns: 3,
      tools: recordingExecutor(),
      client: failing,
    });
    expect(failed.status).toBe("sdk_error");
    expect(failed.stopReason).toBe("429 rate limited");
    expect(failed.iterationError).toBeInstanceOf(Error);
  });

  it("nudges past max_tokens truncation a bounded number of times", async () => {
    const truncated: CuaApiMessage = {
      content: [{ type: "text", text: "partial" }],
      stop_reason: "max_tokens",
      usage: {},
    };
    const client = scriptedClient([truncated, truncated, truncated, truncated]);
    const result = await runClaudeCuaSession({
      prompt: "p",
      model: "claude-sonnet-5",
      logger,
      maxTurns: 10,
      tools: recordingExecutor(),
      client,
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toMatch(/truncated by max_tokens 3 times/);
    expect(client.requests).toHaveLength(3);
    const lastMessages = client.requests[2]!.messages as Array<{ role: string; content: unknown }>;
    expect(lastMessages.at(-1)).toMatchObject({ role: "user" });
    expect(String(lastMessages.at(-1)!.content)).toMatch(/cut off/);
  });

  it("honors an aborted signal between turns", async () => {
    const controller = new AbortController();
    const client: CuaMessagesClient = {
      create: async () => {
        controller.abort(new Error("budget exceeded"));
        return {
          content: [toolUse("tu_1", "screenshot", {})],
          stop_reason: "tool_use",
          usage: {},
        };
      },
    };
    const tools = recordingExecutor();
    const result = await runClaudeCuaSession({
      prompt: "p",
      model: "claude-sonnet-5",
      logger,
      maxTurns: 5,
      tools,
      client,
      signal: controller.signal,
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toBe("aborted: budget exceeded");
    expect(tools.calls).toEqual([]);
  });

  it("compresses API history without removing screenshots from retained events", async () => {
    const client = scriptedClient([
      { content: [toolUse("tu_1", "screenshot", {})], stop_reason: "tool_use" },
      { content: [toolUse("tu_2", "screenshot", {})], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "done" }], stop_reason: "end_turn" },
    ]);
    let screenshot = 0;
    const result = await runClaudeCuaSession({
      prompt: "inspect both pages",
      model: "claude-sonnet-5",
      logger,
      maxTurns: 3,
      keepRecentImages: 1,
      client,
      tools: {
        execute: async () => ({
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: `screenshot-${++screenshot}`,
              },
            },
          ],
        }),
      },
    });

    expect(result.status).toBe("completed");
    const messages = client.requests[2]!.messages as Array<{ role: string; content: unknown }>;
    const historyResults = messages
      .filter((message) => message.role === "user" && Array.isArray(message.content))
      .flatMap((message) => message.content as Array<{ content: unknown[] }>);
    expect(historyResults.map((entry) => entry.content)).toEqual([
      [{ type: "text", text: "[earlier screenshot omitted]" }],
      [
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "screenshot-2" },
        },
      ],
    ]);
    expect(
      result.events.filter((event) => event.type === "tool_result").map((event) => event.content),
    ).toEqual([
      [
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "screenshot-1" },
        },
      ],
      [
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "screenshot-2" },
        },
      ],
    ]);
  });

  it("keeps only the most recent screenshots in the transcript", () => {
    const image = (n: number) => ({
      type: "tool_result",
      tool_use_id: `tu_${n}`,
      content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "x" } }],
    });
    const messages = [
      { role: "user", content: "prompt" },
      { role: "assistant", content: [] },
      { role: "user", content: [image(1), image(2)] },
      { role: "assistant", content: [] },
      { role: "user", content: [image(3)] },
    ];
    compressTranscriptImages(messages, 2);
    const contents = messages
      .filter((m) => Array.isArray(m.content))
      .flatMap((m) => m.content as Array<Record<string, unknown>>)
      .map((block) => (block.content as Array<Record<string, unknown>>)[0]!.type);
    expect(contents).toEqual(["text", "image", "image"]);
  });
  it.each([
    [undefined, false],
    [{ input_tokens: 0, output_tokens: 0 }, true],
  ] as const)("distinguishes absent usage from a reported zero (%j)", async (usage, reported) => {
    const result = await runClaudeCuaSession({
      prompt: "p",
      model: "claude-sonnet-5",
      logger,
      maxTurns: 1,
      tools: recordingExecutor(),
      client: scriptedClient([{ content: [{ type: "text", text: "done" }], usage }]),
    });
    expect(result.usageReported).toBe(reported);
    expect(result.tokenUsage.total).toBe(0);
  });
});
