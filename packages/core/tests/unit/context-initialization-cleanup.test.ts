import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
}));

vi.mock("../../lib/v3/understudy/cdp", () => ({
  CdpConnection: {
    connect: mocks.connect,
  },
}));

describe("V3Context initialization cleanup", () => {
  it("closes the CDP connection when bootstrap fails", async () => {
    const bootstrapError = new Error("auto-attach failed");
    const connection = {
      on: vi.fn(),
      enableAutoAttach: vi.fn().mockRejectedValue(bootstrapError),
      getTargets: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    mocks.connect.mockResolvedValue(connection);

    const { V3Context } = await import("../../lib/v3/understudy/context.js");

    await expect(V3Context.create("ws://failed-bootstrap")).rejects.toBe(
      bootstrapError,
    );
    expect(connection.close).toHaveBeenCalledOnce();
  });
});
