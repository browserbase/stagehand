import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AvailableModel, TaskSpec } from "@browserbasehq/stagehand";
import { EvalLogger } from "../../logger.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import type { PreparedExternalHarnessAdapter } from "../../framework/externalHarnessToolAdapter.js";
import { BARE_LOOP_DEFAULT_SYSTEM_PROMPT } from "../../framework/externalHarnessToolAdapter.js";
import {
  normalizeCursorModel,
  runCursorSdkAgent,
  type CursorSdk,
} from "../../framework/cursorSdkRunner.js";
import { cursorAdapter } from "../../framework/harnesses/cursorAdapter.js";

const plan: ExternalHarnessTaskPlan = {
  dataset: "webtailbench",
  taskId: "wtb-1",
  startUrl: "https://example.com",
  instruction: "Find the checkout button",
};

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await fsp.rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

async function makeAdapter(): Promise<PreparedExternalHarnessAdapter> {
  tempDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), "stagehand-evals-cursor-test-"),
  );
  const bin = path.join(tempDir, "browse");
  await fsp.writeFile(bin, '#!/usr/bin/env bash\necho "browse-output:$@"\n', {
    mode: 0o755,
  });
  return {
    cwd: tempDir,
    env: { ...process.env } as Record<string, string>,
    browseBinPath: bin,
    skillMode: "none",
    systemPromptAddendum: BARE_LOOP_DEFAULT_SYSTEM_PROMPT,
    metadata: { toolCommand: "browse", browseCliEntrypoint: bin },
    cleanup: async () => {},
  };
}

describe("cursor_sdk runner", () => {
  it("normalizes cursor-prefixed models and rejects other providers", () => {
    expect(normalizeCursorModel("cursor/composer-2.5" as AvailableModel)).toBe(
      "composer-2.5",
    );
    expect(normalizeCursorModel("composer-2.5" as AvailableModel)).toBe(
      "composer-2.5",
    );
    expect(normalizeCursorModel("cursor/default" as AvailableModel)).toBe(
      "composer-2.5",
    );
    expect(() =>
      normalizeCursorModel("openai/gpt-5.4" as AvailableModel),
    ).toThrow(/only accepts cursor models/);
  });

  it("creates a local agent with the gated browse custom tool and collects the stream", async () => {
    const adapter = await makeAdapter();
    let capturedCreateOptions: Record<string, unknown> | undefined;
    let capturedPrompt: string | undefined;
    let closed = false;

    const sdk: CursorSdk = {
      Agent: {
        create: async (options) => {
          capturedCreateOptions = options;
          return {
            send: async (message: string) => {
              capturedPrompt = message;
              const local = options.local as {
                customTools: Record<
                  string,
                  {
                    execute: (
                      args: Record<string, unknown>,
                    ) => Promise<unknown>;
                  }
                >;
              };
              const browseOutput = await local.customTools.browse.execute({
                args: "--help",
              });
              return {
                stream: async function* () {
                  yield {
                    type: "assistant",
                    message: {
                      role: "assistant",
                      content: [{ type: "text", text: "Checking the CLI." }],
                    },
                  };
                  yield {
                    type: "tool_call",
                    call_id: "c1",
                    name: "browse",
                    status: "completed",
                    args: { args: "--help" },
                    result: browseOutput,
                  };
                  yield {
                    type: "usage",
                    usage: {
                      inputTokens: 200,
                      outputTokens: 40,
                      cacheReadTokens: 10,
                    },
                  };
                },
                wait: async () => ({
                  status: "finished",
                  result:
                    'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"checkout"}',
                  usage: {
                    inputTokens: 200,
                    outputTokens: 40,
                    cacheReadTokens: 10,
                  },
                }),
              };
            },
            close: () => {
              closed = true;
            },
          };
        },
      },
    };

    const result = await runCursorSdkAgent({
      plan,
      model: "cursor/composer-2.5" as AvailableModel,
      logger: new EvalLogger(false),
      toolAdapter: adapter,
      sdk,
    });

    expect((capturedCreateOptions?.model as { id: string }).id).toBe(
      "composer-2.5",
    );
    const local = capturedCreateOptions?.local as Record<string, unknown>;
    expect(local.cwd).toBe(adapter.cwd);
    expect(capturedPrompt).toContain(BARE_LOOP_DEFAULT_SYSTEM_PROMPT);
    expect(capturedPrompt).toContain("Find the checkout button");
    expect(capturedPrompt).toContain('Use ONLY the custom "browse" tool');
    expect(closed).toBe(true);
    expect(result._success).toBe(true);
    expect(result.finalAnswer).toBe("checkout");
    expect(result.cursorStatus).toBe("completed");
    const metrics = result.metrics as Record<string, { value: number }>;
    expect(metrics.cursor_tool_calls.value).toBe(1);
    expect(metrics.cursor_input_tokens.value).toBe(200);
    expect(metrics.cursor_output_tokens.value).toBe(40);
    expect(metrics.cursor_total_tokens.value).toBe(240);
  });

  it("propagates a failing browse command's isError through the recorded trajectory", async () => {
    const adapter = await makeAdapter();
    // Overwrite the stub `browse` binary to fail, so runBareBrowseCommand
    // returns ok:false.
    await fsp.writeFile(
      adapter.browseBinPath,
      '#!/usr/bin/env bash\necho "boom" >&2\nexit 1\n',
      { mode: 0o755 },
    );

    let capturedToolResult: unknown;
    const sdk: CursorSdk = {
      Agent: {
        create: async (options) => {
          return {
            send: async () => {
              const local = options.local as {
                customTools: Record<
                  string,
                  {
                    execute: (args: Record<string, unknown>) => Promise<{
                      content: Array<{ type: string; text: string }>;
                      isError: boolean;
                    }>;
                  }
                >;
              };
              capturedToolResult = await local.customTools.browse.execute({
                args: "open https://example.com",
              });
              const { isError, content } = capturedToolResult as {
                isError: boolean;
                content: Array<{ type: string; text: string }>;
              };
              return {
                // Mirrors what the real SDK does with a custom tool's
                // isError/content: a terminal tool_call event whose status
                // reflects isError, carrying the same content as `result`.
                stream: async function* () {
                  yield {
                    type: "tool_call",
                    call_id: "c1",
                    name: "browse",
                    status: isError ? "error" : "completed",
                    args: { args: "open https://example.com" },
                    result: content[0]?.text ?? "",
                  };
                },
                wait: async () => ({
                  status: "finished",
                  result:
                    'EVAL_RESULT: {"success":false,"summary":"browse command failed"}',
                }),
              };
            },
            close: () => {},
          };
        },
      },
    };

    await runCursorSdkAgent({
      plan,
      model: "cursor/composer-2.5" as AvailableModel,
      logger: new EvalLogger(false),
      toolAdapter: adapter,
      sdk,
    });

    // The custom tool itself must report isError:true — not just a bare
    // output string the SDK has no way to read as a failure.
    expect(capturedToolResult).toMatchObject({ isError: true });
    const toolContent = (
      capturedToolResult as { content: Array<{ text: string }> }
    ).content[0].text;
    expect(toolContent).toContain("boom");

    // And once that isError flows through a terminal tool_call event (as the
    // real SDK does), the trajectory adapter must land it as ok:false.
    const trajectory = cursorAdapter.fromHarnessResult(
      {
        messages: [
          {
            type: "tool_call",
            call_id: "c1",
            name: "browse",
            status: "error",
            args: { args: "open https://example.com" },
            result: toolContent,
          },
        ],
        status: "error",
      },
      {
        id: "wtb-1",
        instruction: "Find the checkout button",
        initUrl: "https://example.com",
      },
    );
    expect(trajectory.steps[0].toolOutput?.ok).toBe(false);
  });

  it("returns a failed task result instead of throwing on SDK errors", async () => {
    const adapter = await makeAdapter();
    const sdk: CursorSdk = {
      Agent: {
        create: async () => {
          throw new Error("cursor exploded");
        },
      },
    };

    const result = await runCursorSdkAgent({
      plan,
      model: "cursor/composer-2.5" as AvailableModel,
      logger: new EvalLogger(false),
      toolAdapter: adapter,
      sdk,
    });

    expect(result._success).toBe(false);
    expect(result.cursorStatus).toBe("sdk_error");
    expect(result.error).toContain("cursor exploded");
  });
});

describe("cursor trajectory adapter", () => {
  const taskSpec: TaskSpec = {
    id: "wtb-1",
    instruction: "Find the checkout button",
    initUrl: "https://example.com",
  };

  it("maps tool_call messages to steps with buffered reasoning and sums usage", () => {
    const trajectory = cursorAdapter.fromHarnessResult(
      {
        messages: [
          {
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "First I will read the help." }],
            },
          },
          { type: "thinking", text: "The CLI is unfamiliar." },
          {
            type: "tool_call",
            call_id: "c1",
            name: "browse",
            status: "running",
            args: { args: "--help" },
          },
          {
            type: "tool_call",
            call_id: "c1",
            name: "browse",
            status: "completed",
            args: { args: "--help" },
            result: "usage: browse ...",
          },
          {
            type: "tool_call",
            call_id: "c2",
            name: "browse",
            status: "error",
            args: { args: "bogus" },
            result: "unknown command",
          },
          {
            type: "usage",
            usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5 },
          },
          {
            type: "usage",
            usage: { inputTokens: 50, outputTokens: 10, cacheReadTokens: 0 },
          },
          {
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "All done." }],
            },
          },
        ],
        status: "complete",
      },
      taskSpec,
    );

    expect(trajectory.steps).toHaveLength(2);
    expect(trajectory.steps[0].actionName).toBe("browse");
    expect(trajectory.steps[0].reasoning).toContain(
      "First I will read the help.",
    );
    expect(trajectory.steps[0].reasoning).toContain("The CLI is unfamiliar.");
    expect(trajectory.steps[0].toolOutput?.ok).toBe(true);
    expect(trajectory.steps[0].toolOutput?.result).toBe("usage: browse ...");
    expect(trajectory.steps[1].toolOutput?.ok).toBe(false);
    expect(trajectory.finalAnswer).toBe("All done.");
    expect(trajectory.usage.input_tokens).toBe(150);
    expect(trajectory.usage.output_tokens).toBe(30);
    expect(trajectory.usage.cached_input_tokens).toBe(5);
  });
});
