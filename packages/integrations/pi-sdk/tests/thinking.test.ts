import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PI_THINKING_LEVEL, runPiSession } from "../src/session.js";

const pi = vi.hoisted(() => ({
  resolveCliModel: vi.fn(),
  createAgentSession: vi.fn(),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  ModelRuntime: { create: async () => ({}) },
  resolveCliModel: pi.resolveCliModel,
  createAgentSession: pi.createAgentSession,
  SettingsManager: { inMemory: () => ({}) },
  SessionManager: { inMemory: () => ({}) },
  createExtensionRuntime: () => ({}),
}));

describe("pi thinking precedence through the SDK loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pi.createAgentSession.mockResolvedValue({
      session: {
        agent: { state: {} },
        subscribe: () => () => {},
        prompt: async () => {},
        abort: async () => {},
        dispose: () => {},
      },
    });
  });

  it.each([
    { explicit: undefined, resolved: "high", expected: "high" },
    { explicit: "off", resolved: "high", expected: "off" },
    { explicit: undefined, resolved: undefined, expected: DEFAULT_PI_THINKING_LEVEL },
  ])(
    "uses explicit=$explicit, resolved=$resolved => $expected",
    async ({ explicit, resolved, expected }) => {
      const model = { id: "fixture", provider: "openai" };
      pi.resolveCliModel.mockReturnValue({ model, thinkingLevel: resolved });
      const cliModel = `openai/fixture${resolved ? `:${resolved}` : ""}`;
      // Exercise runPiSession -> loadPiSdk -> the provider's model resolver; an
      // injected PiSdk would bypass the point where model suffixes are resolved.
      const result = await runPiSession({
        model: cliModel,
        prompt: "Fixture task",
        session: { ...(explicit !== undefined && { thinkingLevel: explicit }) },
        logger: { log: () => {}, warn: () => {}, error: () => {} },
      });
      expect(result.status).toBe("completed");
      expect(pi.resolveCliModel).toHaveBeenCalledWith({ cliModel, modelRuntime: {} });
      expect(pi.createAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          model,
          thinkingLevel: expected,
        }),
      );
    },
  );
});
