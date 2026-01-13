import { describe, expectTypeOf, it, expect } from "vitest";
import * as Stagehand from "../../dist/index.js";
import { type Tool } from "ai";
import { z } from "zod";

/**
 * Test to verify tool-related exports from Stagehand.
 * Users should be able to create custom tools using the exported `tool` function
 * without needing to install the ai package directly.
 */
describe("Tool exports from AI SDK", () => {
  it("exports Tool type that matches AI SDK Tool type", () => {
    expectTypeOf<Stagehand.Tool>().toEqualTypeOf<Tool>();
  });

  it("exports tool function", () => {
    expect(typeof Stagehand.tool).toBe("function");
  });

  it("tool function can be used to define custom tools", () => {
    const customTool = Stagehand.tool({
      description: "A test tool",
      inputSchema: z.object({
        input: z.string(),
      }),
      execute: async ({ input }) => {
        return { result: `Processed: ${input}` };
      },
    });

    expect(customTool).toBeDefined();
    expect(customTool.description).toBe("A test tool");
  });
});
