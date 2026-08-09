import { describe, expect, it, vi } from "vitest";

import { DriverSessionManager } from "../src/lib/driver/session-manager.js";

/**
 * Build a manager whose `openResult` can run without a live browser: a fake
 * page plus a minimal context so `pageSummaries()` resolves.
 */
function managerWithPage(url: string) {
  const manager = new DriverSessionManager("http-status", {
    headless: true,
    kind: "managed-local",
  });
  const page = {
    targetId: () => "target-1",
    title: vi.fn(async () => "Example"),
    url: () => url,
  };
  Object.assign(manager, { context: { pages: () => [page] } });
  return { manager, page };
}

describe("openResult httpStatus", () => {
  it("surfaces httpStatus on a 4xx navigation", async () => {
    const { manager, page } = managerWithPage("https://example.com/missing");

    const result = await manager.openResult(
      page as unknown as Parameters<DriverSessionManager["openResult"]>[0],
      404,
    );

    expect(result.httpStatus).toBe(404);
  });

  it("surfaces httpStatus on a 200 navigation", async () => {
    const { manager, page } = managerWithPage("https://example.com/");

    const result = await manager.openResult(
      page as unknown as Parameters<DriverSessionManager["openResult"]>[0],
      200,
    );

    expect(result.httpStatus).toBe(200);
  });

  it("omits httpStatus entirely when no response status was captured", async () => {
    const { manager, page } = managerWithPage("https://example.com/");

    const result = await manager.openResult(
      page as unknown as Parameters<DriverSessionManager["openResult"]>[0],
    );

    expect(result.httpStatus).toBeUndefined();
  });
});
