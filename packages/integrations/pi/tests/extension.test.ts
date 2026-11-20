import {
  FACADE_TOOLS,
  FACADE_AGENT_INSTRUCTIONS,
} from "@browserbasehq/stagehand-integrations/facade";
import { describe, expect, it } from "vitest";

import stagehandExtension from "../extensions/stagehand.js";

type Registered = {
  name: string;
  description: string;
  promptGuidelines?: string[];
  promptSnippet?: string;
  execute?: (
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<{ content: Array<{ type: string; text?: string }>; details?: unknown }>;
};

function registeredTools(): Registered[] {
  const tools: Registered[] = [];
  const fakePi = {
    registerTool: (tool: Registered) => tools.push(tool),
    on: () => undefined,
  };
  stagehandExtension(fakePi as never);
  return tools;
}

// The contract itself is pinned by core's facade tests; this asserts the pi
// extension registers exactly the contract tools with imported descriptions.
describe("pi stagehand extension", () => {
  it("registers the three facade tools with the canonical contract", () => {
    const tools = registeredTools();
    const expected = FACADE_TOOLS.map((tool) => tool.name).sort();
    expect(tools.map((tool) => tool.name).sort()).toEqual(expected);
    for (const contractTool of FACADE_TOOLS) {
      const registered = tools.find((tool) => tool.name === contractTool.name);
      expect(registered?.description).toBe(contractTool.description);
    }
  });

  it("forwards the canonical agent instructions as guidelines", () => {
    const run = registeredTools().find((tool) => tool.name === "run");
    expect(run?.promptGuidelines).toEqual([FACADE_AGENT_INSTRUCTIONS]);
  });

  it("advertises the vision requirement on screenshot", () => {
    const screenshot = registeredTools().find((tool) => tool.name === "screenshot");
    expect(screenshot?.promptSnippet).toContain("vision");
  });

  it("refuses screenshot for a text-only model instead of returning an image", async () => {
    const screenshot = registeredTools().find((tool) => tool.name === "screenshot");
    const result = await screenshot?.execute?.("call-1", {}, undefined, undefined, {
      model: { provider: "opencode-go", id: "qwen3.7-max", input: ["text"] },
    });
    expect(result?.details).toEqual({ skipped: "model-has-no-image-input" });
    expect(result?.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("opencode-go/qwen3.7-max does not accept image input"),
      },
    ]);
  });

  it("does not launch a browser at registration time", () => {
    // Registration with no credentials must not throw or open anything.
    expect(() => registeredTools()).not.toThrow();
  });
});
