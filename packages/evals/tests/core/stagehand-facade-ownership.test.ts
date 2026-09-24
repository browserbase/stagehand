import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvalLogger } from "../../logger.js";

const { startBridge, bridge, release } = vi.hoisted(() => ({
  startBridge: vi.fn(),
  release: vi.fn(async () => undefined),
  bridge: {
    port: 1234,
    mcpServerSpec: { command: "node", args: [] as string[], env: {} },
    close: vi.fn(async () => undefined),
    sessionInfo: vi.fn(async () => ({ provider: "browserbase", sessionId: "owned-session" })),
    captureEvidence: vi.fn(async () => ({})),
    callTool: vi.fn(),
    browserSessionLoss: vi.fn(),
  },
}));
vi.mock("../../core/tools/stagehandFacadeBridge.js", () => ({
  startStagehandFacadeBridge: startBridge,
}));
import { StagehandFacadeTool } from "../../core/tools/stagehand_facade.js";

const input = {
  environment: "BROWSERBASE" as const,
  startupProfile: "tool_create_browserbase" as const,
  logger: {} as EvalLogger,
};
const makeTool = () =>
  new StagehandFacadeTool({
    serverSpec: () => ({ command: "node", args: [] as string[], env: {} }),
    sharedExtension: async () => ({ extensionId: "owned-extension", release }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  startBridge.mockResolvedValue(bridge);
  bridge.close.mockResolvedValue(undefined);
});

describe("facade ownership cleanup", () => {
  it("releases the upload lease when bridge startup fails", async () => {
    const failure = new Error("startup failed");
    startBridge.mockRejectedValueOnce(failure);
    await expect(makeTool().start(input)).rejects.toBe(failure);
    expect(release).toHaveBeenCalledOnce();
  });

  it("releases the upload even when bridge cleanup fails and settles cleanup only once", async () => {
    const running = await makeTool().start(input);
    const failure = new Error("bridge cleanup failed");
    bridge.close.mockRejectedValueOnce(failure);
    const sessionClose = vi.spyOn(running.session, "close");
    const first = running.cleanup();
    expect(running.cleanup()).toBe(first);
    await expect(first).rejects.toMatchObject({
      message: "Failed to clean up the Stagehand facade.",
      cause: { errors: [failure] },
    });
    expect(sessionClose).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("releases the upload when session cleanup fails", async () => {
    const running = await makeTool().start(input);
    const failure = new Error("session cleanup failed");
    vi.spyOn(running.session, "close").mockRejectedValue(failure);
    await expect(running.cleanup()).rejects.toMatchObject({
      message: "Failed to clean up the Stagehand facade.",
      cause: { errors: [failure] },
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it("retains every cleanup failure behind a fixed public diagnostic", async () => {
    const running = await makeTool().start(input);
    const first = new Error("apiKey=private-key");
    const second = new Error("session failed");
    bridge.close.mockRejectedValueOnce(first);
    vi.spyOn(running.session, "close").mockRejectedValueOnce(second);
    await expect(running.cleanup()).rejects.toMatchObject({
      message: "Failed to clean up the Stagehand facade.",
      cause: { errors: [first, second] },
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it("passes the shared upload to the existing facade and records its session identity", async () => {
    const running = await makeTool().start(input);
    expect(startBridge).toHaveBeenCalledWith(
      expect.objectContaining({
        server: expect.objectContaining({
          env: { STAGEHAND_BROWSERBASE_EXTENSION_ID: "owned-extension" },
        }),
      }),
    );
    expect(running.metadata.browserbaseSessionId).toBe("owned-session");
    expect(running.metadata.browserbaseSessionUrl).toBe(
      "https://www.browserbase.com/sessions/owned-session",
    );
    await running.cleanup();
    expect(release).toHaveBeenCalledOnce();
  });
});
