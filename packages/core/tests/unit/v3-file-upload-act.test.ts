import { describe, expect, it, vi } from "vitest";
import { V3 } from "../../lib/v3/v3.js";
import type { Action } from "../../lib/v3/types/public/methods.js";

type TestV3 = V3 & Record<string, unknown>;

describe("V3 act file upload routing", () => {
  it("uses remote observe and local setInputFiles for hosted file uploads", async () => {
    const stagehand = Object.create(V3.prototype) as TestV3;
    const mutableStagehand = stagehand as Record<string, unknown>;
    const mockPage = { mainFrameId: () => "frame-1" };
    const uploadAction: Action = {
      selector: "xpath=/html/body/input",
      description: "resume file input",
      method: "setInputFiles",
      arguments: ["%resume%"],
    };

    const observe = vi.fn().mockResolvedValue([uploadAction]);
    const act = vi.fn();
    const takeDeterministicAction = vi.fn().mockResolvedValue({
      success: true,
      message: "ok",
      actions: [uploadAction],
    });

    mutableStagehand["instanceId"] = "test-instance";
    mutableStagehand["actHandler"] = { takeDeterministicAction };
    mutableStagehand["apiClient"] = { observe, act };
    mutableStagehand["domSettleTimeoutMs"] = 1_000;
    mutableStagehand["actCache"] = { enabled: false };
    mutableStagehand["resolvePage"] = vi.fn().mockResolvedValue(mockPage);
    mutableStagehand["resolveLlmClient"] = vi.fn().mockReturnValue({});
    mutableStagehand["addToHistory"] = vi.fn();
    mutableStagehand["isAgentReplayRecording"] = () => false;

    await stagehand.act("upload %resume% to the resume field", {
      variables: { resume: "/tmp/resume.pdf" },
    });

    expect(observe).toHaveBeenCalledOnce();
    expect(act).not.toHaveBeenCalled();
    expect(takeDeterministicAction).toHaveBeenCalledWith(
      uploadAction,
      mockPage,
      1_000,
      expect.anything(),
      expect.any(Function),
      { resume: "/tmp/resume.pdf" },
      "upload %resume% to the resume field",
    );
  });

  it("executes setInputFiles actions locally when passed an Action", async () => {
    const stagehand = Object.create(V3.prototype) as TestV3;
    const mutableStagehand = stagehand as Record<string, unknown>;
    const mockPage = { mainFrameId: () => "frame-1" };
    const uploadAction: Action = {
      selector: "xpath=/html/body/input",
      description: "resume file input",
      method: "setInputFiles",
      arguments: ["/tmp/resume.pdf"],
    };

    const act = vi.fn();
    const takeDeterministicAction = vi.fn().mockResolvedValue({
      success: true,
      message: "ok",
      actions: [uploadAction],
    });

    mutableStagehand["instanceId"] = "test-instance";
    mutableStagehand["actHandler"] = { takeDeterministicAction };
    mutableStagehand["apiClient"] = { act };
    mutableStagehand["domSettleTimeoutMs"] = 1_000;
    mutableStagehand["resolvePage"] = vi.fn().mockResolvedValue(mockPage);
    mutableStagehand["resolveLlmClient"] = vi.fn().mockReturnValue({});
    mutableStagehand["addToHistory"] = vi.fn();

    await stagehand.act(uploadAction, {
      variables: { resume: "/tmp/resume.pdf" },
    });

    expect(act).not.toHaveBeenCalled();
    expect(takeDeterministicAction).toHaveBeenCalledWith(
      uploadAction,
      mockPage,
      1_000,
      expect.anything(),
      expect.any(Function),
      { resume: "/tmp/resume.pdf" },
    );
  });

  it("resolves file variables for observed setInputFiles actions with empty arguments", async () => {
    const stagehand = Object.create(V3.prototype) as TestV3;
    const mutableStagehand = stagehand as Record<string, unknown>;
    const mockPage = { mainFrameId: () => "frame-1" };
    const uploadAction: Action = {
      selector: "xpath=/html/body/input",
      description: "file upload input",
      method: "setInputFiles",
      arguments: [],
    };

    const act = vi.fn();
    const takeDeterministicAction = vi.fn().mockResolvedValue({
      success: true,
      message: "ok",
      actions: [uploadAction],
    });

    mutableStagehand["instanceId"] = "test-instance";
    mutableStagehand["actHandler"] = { takeDeterministicAction };
    mutableStagehand["apiClient"] = { act };
    mutableStagehand["domSettleTimeoutMs"] = 1_000;
    mutableStagehand["resolvePage"] = vi.fn().mockResolvedValue(mockPage);
    mutableStagehand["resolveLlmClient"] = vi.fn().mockReturnValue({});
    mutableStagehand["addToHistory"] = vi.fn();

    await stagehand.act(uploadAction, {
      variables: { resume: "/tmp/resume.pdf" },
    });

    expect(act).not.toHaveBeenCalled();
    expect(takeDeterministicAction).toHaveBeenCalledWith(
      uploadAction,
      mockPage,
      1_000,
      expect.anything(),
      expect.any(Function),
      { resume: "/tmp/resume.pdf" },
    );
  });
});
