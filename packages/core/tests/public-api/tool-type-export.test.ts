import { describe, expectTypeOf, it } from "vitest";
import * as Stagehand from "../../dist/index.js";
import type { Tool } from "ai";

/**
 * Test to verify the Tool type from AI SDK is properly re-exported from Stagehand.
 * This allows users to import Tool from @browserbasehq/stagehand instead of ai-sdk directly.
 */
describe("Tool type export from AI SDK", () => {
  it("exports Tool type that matches AI SDK Tool type", () => {
    // The Tool type from Stagehand should be equivalent to the Tool type from ai
    expectTypeOf<Stagehand.Tool>().toEqualTypeOf<Tool>();
  });

  it("Tool type is usable for defining tools", () => {
    // Verify the Tool type can be used to define a tool (basic type compatibility check)
    type TestTool = Stagehand.Tool;
    const _checkType: TestTool = undefined as unknown as TestTool;
    void _checkType;
  });
});
