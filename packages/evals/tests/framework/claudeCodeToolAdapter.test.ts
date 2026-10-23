import { describe, expect, it } from "vitest";
import {
  resolveClaudeCodeStartupProfile,
  resolveClaudeCodeToolSurface,
  waitForCdpEvent,
} from "../../framework/claudeCodeToolAdapter.js";
import type { CdpEventMessage } from "../../core/tools/cdp_code.js";

describe("claude code tool adapter resolution", () => {
  it("defaults Claude Code to Playwright with a runner-provided browser", () => {
    const tool = resolveClaudeCodeToolSurface();
    expect(tool).toBe("playwright_code");
    expect(resolveClaudeCodeStartupProfile(tool, "LOCAL")).toBe(
      "runner_provided_local_cdp",
    );
    expect(resolveClaudeCodeStartupProfile(tool, "BROWSERBASE")).toBe(
      "runner_provided_browserbase_cdp",
    );
  });

  it("supports code tool surfaces as Claude Code run tools", () => {
    expect(resolveClaudeCodeToolSurface("playwright_code")).toBe(
      "playwright_code",
    );
    expect(resolveClaudeCodeStartupProfile("playwright_code", "LOCAL")).toBe(
      "runner_provided_local_cdp",
    );
    expect(
      resolveClaudeCodeStartupProfile("playwright_code", "BROWSERBASE"),
    ).toBe("runner_provided_browserbase_cdp");
    expect(resolveClaudeCodeToolSurface("cdp_code")).toBe("cdp_code");
    expect(resolveClaudeCodeStartupProfile("cdp_code", "LOCAL")).toBe(
      "runner_provided_local_cdp",
    );
    expect(resolveClaudeCodeStartupProfile("cdp_code", "BROWSERBASE")).toBe(
      "runner_provided_browserbase_cdp",
    );
  });

  it("rejects unsupported Claude Code tool surfaces for now", () => {
    expect(() => resolveClaudeCodeToolSurface("understudy_code")).toThrow(
      /supports --tool playwright_code or cdp_code/,
    );
  });

  it("keeps abandoned CDP event waits from becoming unhandled rejections", async () => {
    const listeners = new Set<(event: CdpEventMessage) => void>();
    const connection = {
      onEvent(listener: (event: CdpEventMessage) => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };

    process.on("unhandledRejection", onUnhandled);
    try {
      const wait = waitForCdpEvent(
        connection as never,
        "session-1",
        "Page.frameNavigated",
        1,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(unhandled).toEqual([]);
      await expect(wait).rejects.toThrow(
        'Timed out waiting for CDP event "Page.frameNavigated"',
      );
      expect(listeners.size).toBe(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
