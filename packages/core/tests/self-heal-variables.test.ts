/**
 * BUG-024: Self-Heal Loop Uses Empty Variables Object
 *
 * Regression test to verify that when an action fails and self-heal is triggered,
 * the retry call to `buildActPrompt` receives the `variables` parameter
 * instead of an empty object `{}`.
 *
 * The fix changes line 368 in actHandler.ts from:
 *   buildActPrompt(actCommand, ..., {})
 * to:
 *   buildActPrompt(actCommand, ..., variables)
 *
 * This ensures the LLM knows about available variables during self-heal attempts.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock the prompt module to capture buildActPrompt calls
const buildActPromptSpy = vi.fn();

vi.mock("../../lib/prompt", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/prompt")>();
  return {
    ...original,
    buildActPrompt: (...args: Parameters<typeof original.buildActPrompt>) => {
      buildActPromptSpy(...args);
      return original.buildActPrompt(...args);
    },
  };
});

// Mock captureHybridSnapshot to return minimal valid data
vi.mock("../lib/v3/understudy/a11y/snapshot", () => ({
  captureHybridSnapshot: vi.fn().mockResolvedValue({
    combinedTree: "mock-tree",
    combinedXpathMap: { "1-0": "/html/body/button" },
  }),
  diffCombinedTrees: vi.fn().mockReturnValue("mock-diff"),
}));

// Mock handlerUtils to make performUnderstudyMethod fail first, then succeed
let performCallCount = 0;
vi.mock("../lib/v3/handlers/handlerUtils/actHandlerUtils", () => ({
  performUnderstudyMethod: vi.fn().mockImplementation(async () => {
    performCallCount++;
    if (performCallCount === 1) {
      throw new Error("Element not found - simulating failure for self-heal");
    }
    // Second call succeeds
    return;
  }),
  waitForDomNetworkQuiet: vi.fn().mockResolvedValue(undefined),
}));

// Import ActHandler after mocks are set up
import { ActHandler } from "../lib/v3/handlers/actHandler";

// Create a mock LLM client
function createMockLLMClient() {
  return {
    generateText: vi.fn().mockResolvedValue({
      text: JSON.stringify({
        element: {
          elementId: "1-0",
          description: "click button",
          method: "click",
          arguments: ["%password%"],
        },
      }),
    }),
  } as any;
}

describe("BUG-024: Self-heal passes variables to buildActPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildActPromptSpy.mockClear();
    performCallCount = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes variables (not empty object) to buildActPrompt during self-heal", async () => {
    const mockLLMClient = createMockLLMClient();
    const variables = { password: "secret123", username: "testuser" };

    const handler = new ActHandler(
      mockLLMClient,
      "openai/gpt-4o" as any,
      {},
      () => mockLLMClient,
      undefined,
      false,
      true, // selfHeal enabled
    );

    // Create a mock action that will fail (triggering self-heal)
    const action = {
      selector: "xpath=/html/body/button",
      description: "click the button",
      method: "click",
      arguments: ["%password%"],
    };

    // Create a minimal mock page
    const mockPage = {
      mainFrame: () => ({
        locator: vi.fn().mockReturnValue({
          click: vi.fn().mockRejectedValue(new Error("Element not found")),
        }),
      }),
    } as any;

    // Call takeDeterministicAction which should trigger self-heal
    try {
      await handler.takeDeterministicAction(
        action,
        mockPage,
        undefined,
        mockLLMClient,
        undefined,
        variables, // Pass variables
      );
    } catch {
      // May throw, that's ok
    }

    // Find the buildActPrompt call during self-heal (should be the second call if any)
    const buildActPromptCalls = buildActPromptSpy.mock.calls;

    // If self-heal was triggered, buildActPrompt should have been called
    // and the third argument should be `variables`, not `{}`
    if (buildActPromptCalls.length > 0) {
      const selfHealCall = buildActPromptCalls[buildActPromptCalls.length - 1];
      const passedVariables = selfHealCall[2];

      // THE KEY ASSERTION: variables should NOT be empty object
      // On main (bug): passedVariables === {}
      // With fix: passedVariables === { password: "secret123", username: "testuser" }
      expect(passedVariables).toEqual(variables);
      expect(passedVariables).not.toEqual({});
      expect(Object.keys(passedVariables).length).toBeGreaterThan(0);
    }
  });
});

/**
 * Direct code inspection test - verifies the actual source code
 * This test reads the source file and checks for the bug pattern
 */
describe("BUG-024: Source code inspection", () => {
  it("verifies actHandler.ts passes variables (not {}) in self-heal path", async () => {
    const fs = await import("fs");
    const path = await import("path");

    const actHandlerPath = path.join(
      __dirname,
      "../lib/v3/handlers/actHandler.ts",
    );
    const sourceCode = fs.readFileSync(actHandlerPath, "utf-8");

    // Find the self-heal section - look for the buildActPrompt call after "Take a fresh snapshot"
    // The section looks like:
    //   // Take a fresh snapshot and ask for a new actionable element
    //   ... some code ...
    //   const instruction = buildActPrompt(
    //     actCommand,
    //     Object.values(SupportedPlaywrightAction),
    //     variables,  // or {} if buggy
    //   );
    const selfHealSection = sourceCode.match(
      /\/\/ Take a fresh snapshot[\s\S]*?const instruction = buildActPrompt\([\s\S]*?\);/,
    );

    expect(selfHealSection).not.toBeNull();

    if (selfHealSection) {
      const buildActPromptCall = selfHealSection[0];

      // THE BUG: The call has an empty object {} as the third argument
      const hasBugPattern = buildActPromptCall.includes(
        "Object.values(SupportedPlaywrightAction),\n            {},",
      );

      // THE FIX: The call has `variables` as the third argument
      const hasFixPattern = buildActPromptCall.includes(
        "Object.values(SupportedPlaywrightAction),\n            variables,",
      );

      // This test FAILS on main (bug present) and PASSES with fix
      expect(hasBugPattern).toBe(false); // Should NOT have the bug pattern
      expect(hasFixPattern).toBe(true); // Should have the fix pattern
    }
  });
});

/**
 * Behavior tests for buildActPrompt function
 */
describe("buildActPrompt behavior with variables", () => {
  // Import the real function for behavior tests
  let buildActPrompt: typeof import("../lib/prompt").buildActPrompt;

  beforeEach(async () => {
    // Get the real implementation
    const promptModule = await vi.importActual<typeof import("../lib/prompt")>(
      "../lib/prompt",
    );
    buildActPrompt = promptModule.buildActPrompt;
  });

  it("includes variable information when variables are provided", () => {
    const variables = { password: "secret123", username: "testuser" };
    const result = buildActPrompt("type password", ["fill", "click"], variables);

    expect(result).toContain("%password%");
    expect(result).toContain("%username%");
    expect(result).toContain("The following variables are available");
  });

  it("does NOT include variable information when empty object is passed", () => {
    const result = buildActPrompt("type password", ["fill", "click"], {});

    expect(result).not.toContain("The following variables are available");
    expect(result).not.toContain("%password%");
  });

  it("demonstrates the critical difference between {} and variables", () => {
    const variables = { password: "secret123" };

    // What the LLM sees with variables (correct)
    const withVars = buildActPrompt("fill password field", ["fill"], variables);

    // What the LLM sees with {} (bug)
    const withEmpty = buildActPrompt("fill password field", ["fill"], {});

    // With variables: LLM knows %password% is available
    expect(withVars).toContain(
      "The following variables are available to use in the action: %password%",
    );
    expect(withVars).toContain("Fill the argument variables with the variable name");

    // With {}: LLM has no idea about variables
    expect(withEmpty).not.toContain("variables are available");
    expect(withEmpty).not.toContain("Fill the argument variables");

    // This is why the bug matters: the LLM can't use %password% if it doesn't know about it
  });
});
