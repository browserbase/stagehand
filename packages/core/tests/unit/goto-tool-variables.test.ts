import { describe, expect, it, vi } from "vitest";
import type { Variables } from "../../lib/v3/types/public/agent.js";
import type { Page } from "../../lib/v3/understudy/page.js";
import type { V3 } from "../../lib/v3/v3.js";
import { gotoTool } from "../../lib/v3/agent/tools/goto.js";

describe("gotoTool variables", () => {
  it("substitutes variables for navigation and preserves template URL in replay", async () => {
    const goto = vi.fn().mockResolvedValue(undefined);
    const page = { goto } as unknown as Page;
    const recordAgentReplayStep = vi.fn();

    const v3 = {
      logger: vi.fn(),
      recordAgentReplayStep,
      context: {
        awaitActivePage: vi.fn().mockResolvedValue(page),
      },
    } as unknown as V3;

    const variables: Variables = {
      host: "example.com",
      path: "login",
    };

    const tool = gotoTool(v3, variables);
    const result = await tool.execute({
      url: "https://%host%/%path%",
    });

    expect(goto).toHaveBeenCalledWith("https://example.com/login", {
      waitUntil: "load",
    });
    expect(recordAgentReplayStep).toHaveBeenCalledWith({
      type: "goto",
      url: "https://%host%/%path%",
      waitUntil: "load",
    });
    expect(result).toEqual({
      success: true,
      url: "https://%host%/%path%",
    });
  });
});
