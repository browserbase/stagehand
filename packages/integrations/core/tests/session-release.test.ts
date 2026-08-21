import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrowserbaseSessionReleaseError,
  releaseBrowserbaseSession,
} from "../src/facade/session-release.js";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  retrieve: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@browserbasehq/sdk", () => ({
  default: class Browserbase {
    readonly sessions = {
      retrieve: mocks.retrieve,
      update: mocks.update,
    };

    constructor(options: unknown) {
      mocks.createClient(options);
    }
  },
}));

describe("Browserbase session release", () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.retrieve.mockReset();
    mocks.update.mockReset();
  });

  it("uses a bounded Browserbase SDK client to request release", async () => {
    mocks.update.mockResolvedValueOnce({ status: "COMPLETED" });

    await expect(
      releaseBrowserbaseSession({ apiKey: "test-key", sessionId: "session-one" }),
    ).resolves.toBeUndefined();
    expect(mocks.createClient).toHaveBeenCalledWith({
      apiKey: "test-key",
      baseURL: "https://api.browserbase.com",
      maxRetries: 2,
      timeout: 10_000,
    });
    expect(mocks.update).toHaveBeenCalledWith("session-one", {
      status: "REQUEST_RELEASE",
    });
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it("accepts an already-completed session after a failed release request", async () => {
    mocks.update.mockRejectedValueOnce(new Error("network failed"));
    mocks.retrieve.mockResolvedValueOnce({ status: "COMPLETED" });

    await expect(
      releaseBrowserbaseSession({ apiKey: "test-key", sessionId: "session-one" }),
    ).resolves.toBeUndefined();
    expect(mocks.retrieve).toHaveBeenCalledWith("session-one");
  });

  it("normalizes trailing slashes in a custom Browserbase API URL", async () => {
    mocks.update.mockResolvedValueOnce({ status: "COMPLETED" });

    await releaseBrowserbaseSession({
      apiKey: "test-key",
      baseUrl: "https://api.example.test///",
      sessionId: "session-one",
    });

    expect(mocks.createClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "https://api.example.test" }),
    );
  });

  it("reports a release that remains incomplete", async () => {
    mocks.update.mockRejectedValueOnce(new Error("release failed"));
    mocks.retrieve.mockResolvedValueOnce({ status: "RUNNING" });

    await expect(
      releaseBrowserbaseSession({ apiKey: "test-key", sessionId: "session-one" }),
    ).rejects.toBeInstanceOf(BrowserbaseSessionReleaseError);
  });

  it("encodes the session ID as one URL path segment", async () => {
    mocks.update.mockResolvedValueOnce({ status: "COMPLETED" });

    await releaseBrowserbaseSession({ apiKey: "test-key", sessionId: "session/one?#" });

    expect(mocks.update).toHaveBeenCalledWith("session%2Fone%3F%23", {
      status: "REQUEST_RELEASE",
    });
  });
});
