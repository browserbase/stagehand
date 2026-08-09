import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  retrieve: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@browserbasehq/sdk", () => ({
  default: class MockBrowserbase {
    sessions = mocks;
  },
}));

describe("Browserbase launch cleanup", () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.retrieve.mockReset();
    mocks.update.mockReset();
  });

  it("releases a created session when its response has no connect URL", async () => {
    mocks.create.mockResolvedValue({ id: "created-session" });
    mocks.update.mockResolvedValue(undefined);
    const { createBrowserbaseSession } = await import(
      "../../lib/v3/launch/browserbase.js"
    );

    await expect(
      createBrowserbaseSession("api-key", "project-id"),
    ).rejects.toThrow("unexpected shape");

    expect(mocks.update).toHaveBeenCalledWith("created-session", {
      status: "REQUEST_RELEASE",
      projectId: "project-id",
    });
  });
});
