import { describe, expect, it } from "vitest";
import { buildActPrompt, buildObserveSystemPrompt } from "../../lib/prompt.js";

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

  it("instructs the model to copy complete bracketed element IDs", () => {
    const prompt = buildObserveSystemPrompt(undefined, ["click"]);

    expect(prompt.content).toContain(
      "Always copy the complete ID exactly as shown inside the brackets into elementId",
    );
    expect(prompt.content).toContain('return elementId "0-18372"');
    expect(prompt.content).toContain('never return only "18372"');
  });

  it("instructs observe to upload files without clicking the file input", () => {
    const prompt = buildObserveSystemPrompt(undefined, [
      "click",
      "setInputFiles",
    ]);

    expect(prompt.content).toContain(
      'find, locate, upload, or attach files on an "input, file" element',
    );
    expect(prompt.content).toContain("choose setInputFiles");
    expect(prompt.content).toContain(
      "Do not choose click for a file input when the goal is to upload a file",
    );
  });

  it("instructs act to pass file variables to setInputFiles", () => {
    const prompt = buildActPrompt(
      "upload my resume",
      ["click", "setInputFiles"],
      { resume: "/tmp/resume.pdf" },
    );

    expect(prompt).toContain("choose setInputFiles");
    expect(prompt).toContain(
      "put each file path or matching variable placeholder in the arguments array",
    );
    expect(prompt).toContain("%resume%");
  });
});
