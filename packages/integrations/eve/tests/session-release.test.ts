import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BrowserbaseSessionReleaseError,
  releaseBrowserbaseSession,
} from "../extension/lib/session-release.js";

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
  });

  it("normalizes a custom API URL and encodes the session path segment", async () => {
    mocks.update.mockResolvedValueOnce({ status: "COMPLETED" });

    await releaseBrowserbaseSession({
      apiKey: "test-key",
      baseUrl: "https://api.example.test///",
      sessionId: "session/one?#",
    });

    expect(mocks.createClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "https://api.example.test" }),
    );
    expect(mocks.update).toHaveBeenCalledWith("session%2Fone%3F%23", {
      status: "REQUEST_RELEASE",
    });
  });

  it("reports a release that remains incomplete with a stable error", async () => {
    mocks.update.mockRejectedValueOnce(new Error("release failed"));
    mocks.retrieve.mockResolvedValueOnce({ status: "RUNNING" });

    const error = await releaseBrowserbaseSession({
      apiKey: "test-key",
      sessionId: "session-one",
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(BrowserbaseSessionReleaseError);
    expect(error).toMatchObject({
      name: "BrowserbaseSessionReleaseError",
      message: "Failed to release the Browserbase session.",
    });
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  });
});
