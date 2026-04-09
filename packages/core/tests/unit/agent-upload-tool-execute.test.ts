import { describe, expect, it, vi } from "vitest";
import type { ToolCallOptions } from "ai";
import { uploadTool } from "../../lib/v3/agent/tools/upload.js";
import type { V3 } from "../../lib/v3/v3.js";

const toolCallOptions: ToolCallOptions = {
  toolCallId: "upload-test-call",
  messages: [],
};

function createStubV3() {
  const setInputFiles = vi.fn().mockResolvedValue(undefined);
  const deepLocator = vi.fn().mockReturnValue({
    setInputFiles,
  });
  const awaitActivePage = vi.fn().mockResolvedValue({
    deepLocator,
  });
  const observe = vi.fn().mockResolvedValue([
    {
      description: "Resume upload input",
      selector: "xpath=//input[@type='file']",
    },
  ]);
  const recordAgentReplayStep = vi.fn();
  const logger = vi.fn();

  const v3 = {
    observe,
    context: {
      awaitActivePage,
    },
    isAgentReplayActive: () => true,
    recordAgentReplayStep,
    logger,
  } as unknown as V3;

  return {
    v3,
    spies: {
      awaitActivePage,
      deepLocator,
      logger,
      observe,
      recordAgentReplayStep,
      setInputFiles,
    },
  };
}

describe("uploadTool", () => {
  it("uploads files found via observe and records a replay step", async () => {
    const { v3, spies } = createStubV3();
    const tool = uploadTool(v3, undefined, {
      resumePath: "/tmp/resume.pdf",
    });

    const result = await tool.execute(
      {
        target: "the resume file input",
        paths: ["%resumePath%"],
      },
      toolCallOptions,
    );

    expect(spies.observe).toHaveBeenCalledWith(
      expect.stringContaining("the resume file input"),
      {
        variables: { resumePath: "/tmp/resume.pdf" },
        timeout: undefined,
      },
    );
    expect(spies.deepLocator).toHaveBeenCalledWith(
      "xpath=//input[@type='file']",
    );
    expect(spies.setInputFiles).toHaveBeenCalledWith("/tmp/resume.pdf");
    expect(spies.recordAgentReplayStep).toHaveBeenCalledWith({
      type: "upload",
      target: "the resume file input",
      selector: "xpath=//input[@type='file']",
      paths: ["/tmp/resume.pdf"],
    });
    expect(result).toEqual({
      success: true,
      target: "Resume upload input",
      selector: "xpath=//input[@type='file']",
      files: ["resume.pdf"],
      fileCount: 1,
    });
  });

  it("returns a helpful error when observe cannot find a supported file input", async () => {
    const { v3, spies } = createStubV3();
    spies.observe.mockResolvedValueOnce([
      {
        description: "Upload button",
        selector: "not-supported",
      },
    ]);
    const tool = uploadTool(v3);

    const result = await tool.execute(
      {
        target: "the resume file input",
        paths: ["/tmp/resume.pdf"],
      },
      toolCallOptions,
    );

    expect(result).toEqual({
      success: false,
      error:
        "Could not find a file input for the resume file input. Ask the agent to target the actual upload input field.",
    });
    expect(spies.setInputFiles).not.toHaveBeenCalled();
  });
});
