import { describe, expect, it, vi } from "vitest";
import { FacadeResourceOwner } from "../src/facade/resource-owner.js";
import { StagehandFacadeConfigError } from "../src/facade/config.js";
import {
  StagehandFacadeCleanupError,
  StagehandFacadeInitializationError,
} from "../src/facade/tools.js";

describe("FacadeResourceOwner", () => {
  it("waits for cleanup before launching replacement resources", async () => {
    let release!: () => void;
    const closing = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = { id: 1 };
    const second = { id: 2 };
    const create = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const cleanup = vi.fn(() => closing);
    const owner = new FacadeResourceOwner(create, cleanup);
    await expect(owner.get()).resolves.toBe(first);
    const close = owner.close(first);
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
    const next = owner.get();
    await Promise.resolve();
    expect(create).toHaveBeenCalledOnce();
    await expect(owner.peek()).resolves.toBe(first);
    release();
    await close;
    await expect(next).resolves.toBe(second);
    expect(create).toHaveBeenCalledTimes(2);
    await owner.close(first);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("retains failed cleanup and refuses to launch another browser", async () => {
    const first = { id: 1 };
    const failure = new Error("provider-private-detail", { cause: "private-cause" });
    const create = vi.fn(async () => first);
    const cleanup = vi.fn(async () => {
      throw failure;
    });
    const owner = new FacadeResourceOwner(create, cleanup);
    await owner.get();
    for (const operation of [
      () => owner.close(first),
      () => owner.get(),
      () => owner.close(first),
    ]) {
      const error = await operation().catch((error: unknown) => error);
      expect(error).toBeInstanceOf(StagehandFacadeCleanupError);
      expect((error as Error).cause).toBeUndefined();
      expect(String(error)).not.toContain("private");
    }
    await expect(owner.peek()).resolves.toBe(first);
    expect(create).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("retries failed initialization", async () => {
    const first = { id: 1 };
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error("launch failed"))
      .mockResolvedValue(first);
    const owner = new FacadeResourceOwner(create, vi.fn());
    const error = await owner.get().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(StagehandFacadeInitializationError);
    expect((error as Error).cause).toBeUndefined();
    expect(String(error)).not.toContain("launch failed");
    await expect(owner.get()).resolves.toBe(first);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("preserves typed configuration errors without exposing arbitrary initialization failures", async () => {
    const error = new StagehandFacadeConfigError(
      'STAGEHAND_BROWSER must be either "local" or "browserbase".',
    );
    const owner = new FacadeResourceOwner(async () => {
      throw error;
    }, vi.fn());
    await expect(owner.get()).rejects.toBe(error);
  });
});
