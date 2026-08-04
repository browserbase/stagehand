import { describe, expect, it, vi } from "vitest";
import { abortable, abortableDelay } from "../src/abort.js";

describe("abort helpers", () => {
  it("resolves normally and removes its abort listener", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");

    await expect(abortable(Promise.resolve("ready"), controller.signal)).resolves.toBe("ready");

    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("rejects a pre-aborted operation with the original Error reason", async () => {
    const controller = new AbortController();
    const reason = new Error("initialization expired");
    controller.abort(reason);

    await expect(abortable(Promise.resolve("late"), controller.signal)).rejects.toBe(reason);
  });

  it("rejects a pending operation when its signal aborts", async () => {
    const controller = new AbortController();
    const reason = new Error("caller canceled");
    const pending = abortable(new Promise<never>(() => {}), controller.signal);

    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  it("cancels a pending delay without waiting for its timer", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = new Error("stop waiting");
    try {
      const pending = abortableDelay(60_000, controller.signal);
      controller.abort(reason);

      await expect(pending).rejects.toBe(reason);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
