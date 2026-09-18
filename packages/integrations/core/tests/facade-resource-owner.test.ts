import { describe, expect, it, vi } from "vitest";
import { FacadeResourceOwner } from "../src/facade/resource-owner.js";

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
    const failure = new Error("cleanup failed");
    const create = vi.fn(async () => first);
    const cleanup = vi.fn(async () => {
      throw failure;
    });
    const owner = new FacadeResourceOwner(create, cleanup);
    await owner.get();
    await expect(owner.close(first)).rejects.toBe(failure);
    await expect(owner.get()).rejects.toBe(failure);
    await expect(owner.close(first)).rejects.toBe(failure);
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
    await expect(owner.get()).rejects.toThrow("launch failed");
    await expect(owner.get()).resolves.toBe(first);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
