import {
  FACADE_TOOLS,
  FACADE_AGENT_INSTRUCTIONS,
} from "@browserbasehq/stagehand-integrations/facade";
import { describe, expect, it } from "vitest";

import stagehandExtension from "../extensions/stagehand.js";

type Registered = { name: string; description: string; promptGuidelines?: string[] };

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

  it("does not launch a browser at registration time", () => {
    // Registration with no credentials must not throw or open anything.
    expect(() => registeredTools()).not.toThrow();
  });
});
