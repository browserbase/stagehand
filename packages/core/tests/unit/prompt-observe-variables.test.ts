import { describe, expect, it } from "vitest";
import { buildObserveSystemPrompt } from "../../lib/prompt.js";

describe("buildObserveSystemPrompt", () => {
  it("includes variable descriptions when present", () => {
    const prompt = buildObserveSystemPrompt(undefined, ["click", "fill"], {
      username: {
        value: "john@example.com",
        description: "The login email",
      },
      password: "secret123",
    });

    expect(prompt.content).toContain("Supported actions: click, fill");
    expect(prompt.content).toContain(
      "Available variables: %username% (The login email), %password%",
    );
    expect(prompt.content).toContain(
      "return the matching %variableName% placeholder",
    );
  });
});
