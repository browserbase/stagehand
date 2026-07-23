import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogLine } from "../../lib/v3/types/public/logs.js";

const mocks = vi.hoisted(() => ({
  contextCreate: vi.fn(),
  launchLocalChrome: vi.fn(),
  createBrowserbaseSession: vi.fn(),
  browserbaseUpdate: vi.fn(),
}));

vi.mock("../../lib/v3/understudy/context", () => ({
  V3Context: {
    create: mocks.contextCreate,
  },
}));

vi.mock("../../lib/v3/launch/local", () => ({
  launchLocalChrome: mocks.launchLocalChrome,
}));

vi.mock("../../lib/v3/launch/browserbase", () => ({
  createBrowserbaseSession: mocks.createBrowserbaseSession,
}));

type V3Internals = {
  instanceId: string;
  stagehandLogger: { log: (line: LogLine) => void };
};

function registeredInstances(): Set<unknown> {
  const { V3 } = requireV3();
  return (V3 as unknown as { _instances: Set<unknown> })._instances;
}

let importedV3: typeof import("../../lib/v3/v3.js") | undefined;

function requireV3(): typeof import("../../lib/v3/v3.js") {
  if (!importedV3) {
    throw new Error("V3 module has not been imported");
  }
  return importedV3;
}

async function loadV3(): Promise<typeof import("../../lib/v3/v3.js")> {
  importedV3 ??= await import("../../lib/v3/v3.js");
  return importedV3;
}

describe("V3 initialization cleanup", () => {
  beforeEach(() => {
    mocks.contextCreate.mockReset();
    mocks.launchLocalChrome.mockReset();
    mocks.createBrowserbaseSession.mockReset();
    mocks.browserbaseUpdate.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes a temporary profile when local launch fails", async () => {
    let profilePath = "";
    mocks.launchLocalChrome.mockImplementation(
      async (options: { userDataDir?: string }) => {
        profilePath = options.userDataDir ?? "";
        throw new Error("debugger discovery failed");
      },
    );
    const { V3 } = await loadV3();
    const v3 = new V3({
      env: "LOCAL",
      disableAPI: true,
      keepAlive: true,
      model: { modelName: "openai/gpt-4.1-mini", apiKey: "test-key" },
    });
    const destroyEventStore = vi.spyOn(v3.eventStore, "destroy");

    await expect(v3.init()).rejects.toThrow("debugger discovery failed");

    expect(profilePath).not.toBe("");
    expect(fs.existsSync(profilePath)).toBe(false);
    expect(destroyEventStore).toHaveBeenCalledOnce();
    expect(registeredInstances().has(v3)).toBe(false);
  });

  it("kills Chrome and removes its profile when context creation fails", async () => {
    const kill = vi.fn().mockResolvedValue(undefined);
    let profilePath = "";
    mocks.launchLocalChrome.mockImplementation(
      async (options: { userDataDir?: string }) => {
        profilePath = options.userDataDir ?? "";
        return {
          ws: "ws://local-browser",
          chrome: { kill },
        };
      },
    );
    mocks.contextCreate.mockRejectedValue(new Error("context failed"));
    const { V3 } = await loadV3();
    const v3 = new V3({
      env: "LOCAL",
      disableAPI: true,
      keepAlive: true,
      model: { modelName: "openai/gpt-4.1-mini", apiKey: "test-key" },
    });
    const internals = v3 as unknown as V3Internals;
    const internalLog = vi.spyOn(internals.stagehandLogger, "log");
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(v3.init()).rejects.toThrow("context failed");

    expect(kill).toHaveBeenCalledOnce();
    expect(fs.existsSync(profilePath)).toBe(false);
    expect(registeredInstances().has(v3)).toBe(false);

    const { v3Logger, withInstanceLogContext } = await import(
      "../../lib/v3/logger.js"
    );
    internalLog.mockClear();
    consoleLog.mockClear();
    withInstanceLogContext(internals.instanceId, () => {
      v3Logger({ category: "test", message: "after cleanup", level: 1 });
    });
    expect(internalLog).not.toHaveBeenCalled();
    expect(consoleLog).toHaveBeenCalledOnce();
  });

  it("releases an owned Browserbase session when context creation fails", async () => {
    mocks.createBrowserbaseSession.mockResolvedValue({
      ws: "wss://browserbase",
      sessionId: "created-session",
      bb: {
        sessions: {
          update: mocks.browserbaseUpdate,
        },
      },
    });
    mocks.contextCreate.mockRejectedValue(new Error("context failed"));
    const { V3 } = await loadV3();
    const v3 = new V3({
      env: "BROWSERBASE",
      apiKey: "browserbase-key",
      projectId: "project-id",
      disableAPI: true,
      keepAlive: true,
      model: { modelName: "openai/gpt-4.1-mini", apiKey: "test-key" },
    });

    await expect(v3.init()).rejects.toThrow("context failed");

    expect(mocks.browserbaseUpdate).toHaveBeenCalledWith("created-session", {
      status: "REQUEST_RELEASE",
      projectId: "project-id",
    });
    expect(registeredInstances().has(v3)).toBe(false);
  });

  it("does not release a caller-owned Browserbase session", async () => {
    mocks.createBrowserbaseSession.mockResolvedValue({
      ws: "wss://browserbase",
      sessionId: "existing-session",
      bb: {
        sessions: {
          update: mocks.browserbaseUpdate,
        },
      },
    });
    mocks.contextCreate.mockRejectedValue(new Error("context failed"));
    const { V3 } = await loadV3();
    const v3 = new V3({
      env: "BROWSERBASE",
      apiKey: "browserbase-key",
      projectId: "project-id",
      browserbaseSessionID: "existing-session",
      disableAPI: true,
      model: { modelName: "openai/gpt-4.1-mini", apiKey: "test-key" },
    });

    await expect(v3.init()).rejects.toThrow("context failed");

    expect(mocks.browserbaseUpdate).not.toHaveBeenCalled();
    expect(registeredInstances().has(v3)).toBe(false);
  });
});
