import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "../../lib/v3/agent/prompts/agentSystemPrompt.js";

describe("buildAgentSystemPrompt variables", () => {
  it("includes variable descriptions when present", () => {
    const prompt = buildAgentSystemPrompt({
      url: "https://example.com",
      executionInstruction: "Fill the form",
      mode: "dom",
      variables: {
        username: {
          value: "john@example.com",
          description: "The login email",
        },
        password: "secret123",
      },
    });

    expect(prompt).toContain(
      '<variable name="username">The login email</variable>',
    );
    expect(prompt).toContain('<variable name="password" />');
  });
});
