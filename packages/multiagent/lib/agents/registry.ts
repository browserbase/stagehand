import type { BrowserSession } from "../browser/session.js";
import type { AgentHarnessOptions } from "../types.js";
import { UnsupportedAdapterError } from "../utils/errors.js";
import { AgentBrowserHarness } from "./harnesses/agentBrowser.js";
import { BrowserUseHarness } from "./harnesses/browserUse.js";
import type { AgentHarness } from "./harnesses/base.js";
import { ClaudeCodeHarness } from "./harnesses/claudeCode.js";
import { CodexHarness } from "./harnesses/codex.js";
import { GeminiCliHarness } from "./harnesses/geminiCli.js";
import { OpencodeHarness } from "./harnesses/opencode.js";
import { StagehandHarness } from "./harnesses/stagehand.js";

export function createAgentHarness(
  options: AgentHarnessOptions,
  browserSession: BrowserSession,
): AgentHarness {
  switch (options.type) {
    case "claude-code":
      return new ClaudeCodeHarness(options);
    case "codex":
      return new CodexHarness(options);
    case "gemini-cli":
      return new GeminiCliHarness(options);
    case "opencode":
      return new OpencodeHarness(options);
    case "agent-browser":
      return new AgentBrowserHarness(options);
    case "browser-use":
      return new BrowserUseHarness(options, browserSession);
    case "stagehand":
      return new StagehandHarness(options, browserSession);
    default:
      throw new UnsupportedAdapterError("Agent harness", String(options.type));
  }
}
