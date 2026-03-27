import { describe, expect, it } from "vitest";
import {
  buildGeminiSettings,
  parseGeminiJsonResult,
} from "../../lib/agents/harnesses/geminiCli.js";
import {
  buildOpencodeConfig,
  parseOpencodeJsonl,
  resolveOpencodeBinaryPath,
} from "../../lib/agents/harnesses/opencode.js";

describe("GeminiCliHarness helpers", () => {
  it("builds isolated Gemini MCP settings from named stdio servers", () => {
    expect(
      buildGeminiSettings([
        {
          name: "playwright",
          config: {
            command: "node",
            args: ["playwright-mcp.js"],
            env: { FOO: "bar" },
            cwd: "/tmp/project",
          },
        },
      ]),
    ).toEqual({
      mcpServers: {
        playwright: {
          type: "stdio",
          command: "node",
          args: ["playwright-mcp.js"],
          env: { FOO: "bar" },
          cwd: "/tmp/project",
        },
      },
      mcp: {
        allowed: ["playwright"],
      },
    });
  });

  it("parses Gemini JSON output", () => {
    expect(
      parseGeminiJsonResult(
        JSON.stringify({
          session_id: "session-1",
          response: "Example Domain",
          stats: { latencyMs: 10 },
        }),
      ),
    ).toEqual({
      session_id: "session-1",
      response: "Example Domain",
      stats: { latencyMs: 10 },
    });
  });
});

describe("OpencodeHarness helpers", () => {
  it("builds isolated OpenCode MCP config", () => {
    expect(
      buildOpencodeConfig([
        {
          name: "chrome-devtools",
          config: {
            command: "node",
            args: ["chrome-devtools-mcp.js", "--headless"],
            env: { DEBUG: "0" },
          },
        },
      ]),
    ).toEqual({
      mcp: {
        "chrome-devtools": {
          type: "local",
          enabled: true,
          command: ["node", "chrome-devtools-mcp.js", "--headless"],
          environment: { DEBUG: "0" },
        },
      },
    });
  });

  it("parses OpenCode JSONL output into content and usage", () => {
    const result = parseOpencodeJsonl(
      [
        JSON.stringify({
          type: "step_start",
          sessionID: "ses_123",
        }),
        JSON.stringify({
          type: "text",
          sessionID: "ses_123",
          part: {
            text: "Example",
          },
        }),
        JSON.stringify({
          type: "text",
          sessionID: "ses_123",
          part: {
            text: " Domain",
          },
        }),
        JSON.stringify({
          type: "step_finish",
          sessionID: "ses_123",
          part: {
            tokens: {
              input: 11,
              output: 7,
              cache: {
                read: 3,
                write: 5,
              },
            },
          },
        }),
      ].join("\n"),
    );

    expect(result).toMatchObject({
      sessionId: "ses_123",
      content: "Example Domain",
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        cachedInputTokens: 8,
      },
    });
  });

  it("prefers an explicit OpenCode binary override", () => {
    expect(
      resolveOpencodeBinaryPath({
        env: {
          MULTIAGENT_OPENCODE_BIN: "/tmp/opencode-native",
        },
        existsSync: (value) => value === "/tmp/opencode-native",
      }),
    ).toBe("/tmp/opencode-native");
  });
});
