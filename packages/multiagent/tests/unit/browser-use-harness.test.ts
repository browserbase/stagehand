import { describe, expect, it } from "vitest";
import {
  buildBrowserUseScript,
  parseBrowserUseResult,
  resolveBrowserUseProvider,
} from "../../lib/agents/harnesses/browserUse.js";

describe("BrowserUseHarness helpers", () => {
  it("maps Anthropic-prefixed models to the Anthropic provider", () => {
    expect(resolveBrowserUseProvider("anthropic/claude-3-7-sonnet-latest")).toEqual({
      provider: "anthropic",
      modelName: "claude-3-7-sonnet-latest",
    });
  });

  it("builds an inline browser-use script for the selected provider", () => {
    const script = buildBrowserUseScript({
      packageSpec: "browser-use[anthropic]",
      importStatement: "from browser_use import ChatAnthropic",
      llmFactory: "ChatAnthropic(model=model_name)",
    });

    expect(script).toContain("from browser_use import Agent, Browser");
    expect(script).toContain("from browser_use import ChatAnthropic");
    expect(script).toContain("history.final_result()");
    expect(script).toContain('Browser(cdp_url=payload["cdpUrl"])');
  });

  it("parses browser-use JSON output", () => {
    const result = parseBrowserUseResult(
      JSON.stringify({
        finalResult: "Example Domain",
        errors: [],
        raw: {
          history: [],
        },
      }),
    );

    expect(result).toEqual({
      content: "Example Domain",
      raw: {
        finalResult: "Example Domain",
        errors: [],
        raw: {
          history: [],
        },
      },
    });
  });
});
