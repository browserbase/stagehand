import { describe, expect, it, vi } from "vitest";
import type { ToolCallOptions } from "ai";
import { actTool } from "../../lib/v3/agent/tools/act.js";
import { clickTool } from "../../lib/v3/agent/tools/click.js";
import { fillFormTool } from "../../lib/v3/agent/tools/fillform.js";
import { fillFormVisionTool } from "../../lib/v3/agent/tools/fillFormVision.js";
import { keysTool } from "../../lib/v3/agent/tools/keys.js";
import { typeTool } from "../../lib/v3/agent/tools/type.js";
import {
  FILE_UPLOAD_GUARD_ERROR,
  getFileUploadGuardError,
} from "../../lib/v3/agent/utils/fileUploadGuard.js";
import type { V3 } from "../../lib/v3/v3.js";

const toolCallOptions: ToolCallOptions = {
  toolCallId: "file-upload-guard-test",
  messages: [],
};

function createMockV3() {
  const page = {
    click: vi.fn(),
    keyPress: vi.fn(),
    type: vi.fn(),
  };
  const awaitActivePage = vi.fn().mockResolvedValue(page);
  const act = vi.fn();
  const observe = vi.fn();

  const v3 = {
    logger: vi.fn(),
    act,
    observe,
    context: {
      awaitActivePage,
    },
    isAgentReplayActive: () => false,
    recordAgentReplayStep: vi.fn(),
  } as unknown as V3;

  return {
    v3,
    spies: {
      act,
      awaitActivePage,
      observe,
      page,
    },
  };
}

describe("file upload guard", () => {
  it("detects file upload intent from paths and upload language", () => {
    expect(
      getFileUploadGuardError(
        'upload "/tmp/resume.pdf" to the resume file input',
      ),
    ).toBe(FILE_UPLOAD_GUARD_ERROR);
    expect(getFileUploadGuardError("click the Upload CV button")).toBe(
      FILE_UPLOAD_GUARD_ERROR,
    );
    expect(getFileUploadGuardError("click the Continue button")).toBeNull();
  });

  it("prevents act from typing local file paths", async () => {
    const { v3, spies } = createMockV3();
    const tool = actTool(v3);

    const result = await tool.execute!(
      {
        action: 'type "/tmp/resume.pdf" into the Agent Profile file input',
      },
      toolCallOptions,
    );

    expect(result).toEqual({
      success: false,
      error: FILE_UPLOAD_GUARD_ERROR,
    });
    expect(spies.act).not.toHaveBeenCalled();
  });

  it("prevents fillForm from treating uploads as standard fields", async () => {
    const { v3, spies } = createMockV3();
    const tool = fillFormTool(v3);

    const result = await tool.execute!(
      {
        fields: [
          {
            action: 'type "/tmp/resume.pdf" into the resume upload field',
          },
        ],
      },
      toolCallOptions,
    );

    expect(result).toEqual({
      success: false,
      error: FILE_UPLOAD_GUARD_ERROR,
    });
    expect(spies.observe).not.toHaveBeenCalled();
    expect(spies.act).not.toHaveBeenCalled();
  });

  it("prevents click from targeting upload controls", async () => {
    const { v3, spies } = createMockV3();
    const tool = clickTool(v3);

    const result = await tool.execute!(
      {
        describe: "the Upload resume button",
        coordinates: [100, 200],
      },
      toolCallOptions,
    );

    expect(result).toEqual({
      success: false,
      error: FILE_UPLOAD_GUARD_ERROR,
    });
    expect(spies.awaitActivePage).not.toHaveBeenCalled();
    expect(spies.page.click).not.toHaveBeenCalled();
  });

  it("prevents type from sending a file path into an input", async () => {
    const { v3, spies } = createMockV3();
    const tool = typeTool(v3);

    const result = await tool.execute!(
      {
        describe: "the Agent Profile file input",
        text: "/tmp/resume.pdf",
        coordinates: [100, 200],
      },
      toolCallOptions,
    );

    expect(result).toEqual({
      success: false,
      error: FILE_UPLOAD_GUARD_ERROR,
    });
    expect(spies.awaitActivePage).not.toHaveBeenCalled();
    expect(spies.page.click).not.toHaveBeenCalled();
    expect(spies.page.type).not.toHaveBeenCalled();
  });

  it("prevents fillFormVision from routing uploads through typing", async () => {
    const { v3, spies } = createMockV3();
    const tool = fillFormVisionTool(v3);

    const result = await tool.execute!(
      {
        fields: [
          {
            action: "type John into the first name field",
            value: "John",
            coordinates: { x: 10, y: 10 },
          },
          {
            action: 'type "/tmp/resume.pdf" into the CV upload field',
            value: "/tmp/resume.pdf",
            coordinates: { x: 20, y: 20 },
          },
        ],
      },
      toolCallOptions,
    );

    expect(result).toEqual({
      success: false,
      error: FILE_UPLOAD_GUARD_ERROR,
    });
    expect(spies.awaitActivePage).not.toHaveBeenCalled();
    expect(spies.page.click).not.toHaveBeenCalled();
    expect(spies.page.type).not.toHaveBeenCalled();
  });

  it("prevents keys(type) from typing local file paths", async () => {
    const { v3, spies } = createMockV3();
    const tool = keysTool(v3);

    const result = await tool.execute!(
      {
        method: "type",
        value: "/tmp/resume.pdf",
      },
      toolCallOptions,
    );

    expect(result).toEqual({
      success: false,
      error: FILE_UPLOAD_GUARD_ERROR,
    });
    expect(spies.awaitActivePage).not.toHaveBeenCalled();
    expect(spies.page.type).not.toHaveBeenCalled();
    expect(spies.page.keyPress).not.toHaveBeenCalled();
  });
});
