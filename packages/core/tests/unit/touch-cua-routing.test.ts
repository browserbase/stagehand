import { describe, expect, it, vi } from "vitest";
import { V3CuaAgentHandler } from "../../lib/v3/handlers/v3CuaAgentHandler.js";
import type { V3 } from "../../lib/v3/v3.js";
import type { Action } from "../../lib/v3/types/public/methods.js";

// The handler's constructor builds a real AgentProvider client (needs API keys),
// but the click-dispatch branch only touches `this.v3`. Build the instance off the
// prototype so the routing decision can be asserted without a provider or browser.
function harness(opts: { usesTouch: boolean; recording?: boolean }) {
  type Pointer = (x: number, y: number, o?: unknown) => Promise<string>;
  const tap = vi.fn<Pointer>(async () => "/html/body/button");
  const click = vi.fn<Pointer>(async () => "/html/body/button");
  const recorded: Array<{ actions?: Action[] }> = [];

  const page = { tap, click };

  const v3 = {
    usesTouch: opts.usesTouch,
    isAgentReplayActive: () => opts.recording ?? false,
    recordAgentReplayStep: (step: { actions?: Action[] }) => {
      recorded.push(step);
    },
    context: { awaitActivePage: async () => page },
  } as unknown as V3;

  const handler = Object.create(
    V3CuaAgentHandler.prototype,
  ) as V3CuaAgentHandler;
  (handler as unknown as { v3: V3 }).v3 = v3;

  const executeAction = (action: unknown) =>
    (
      handler as unknown as {
        executeAction: (a: unknown) => Promise<{ success: boolean }>;
      }
    ).executeAction(action);

  return { executeAction, tap, click, recorded };
}

describe("CUA click touch routing", () => {
  it("sets the client viewport from the shared resolver", async () => {
    const setViewport = vi.fn();
    const resolveViewport = vi.fn(async () => ({ width: 384, height: 696 }));
    const v3 = {
      resolveViewport,
    } as unknown as V3;
    const handler = Object.create(
      V3CuaAgentHandler.prototype,
    ) as V3CuaAgentHandler;
    const internals = handler as unknown as {
      v3: V3;
      agentClient: { setViewport: typeof setViewport };
      updateClientViewport: () => Promise<void>;
    };
    internals.v3 = v3;
    internals.agentClient = { setViewport };

    await internals.updateClientViewport();

    expect(resolveViewport).toHaveBeenCalledOnce();
    expect(setViewport).toHaveBeenCalledOnce();
    expect(setViewport).toHaveBeenCalledWith(384, 696);
  });

  it("taps a single left click on a touch session", async () => {
    const h = harness({ usesTouch: true });
    const result = await h.executeAction({ type: "click", x: 10, y: 20 });

    expect(h.tap).toHaveBeenCalledWith(10, 20);
    expect(h.click).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("clicks on a desktop session", async () => {
    const h = harness({ usesTouch: false });
    await h.executeAction({ type: "click", x: 10, y: 20 });

    expect(h.click).toHaveBeenCalled();
    expect(h.tap).not.toHaveBeenCalled();
  });

  // Right/middle and multi-click carry semantics touch cannot express (context
  // menu, double-click), so they must stay on the mouse path even on mobile.
  it.each([
    ["right", { button: "right" }],
    ["middle", { button: "middle" }],
    ["multi", { clickCount: 2 }],
  ])(
    "keeps %s click on the mouse path on a touch session",
    async (_l, extra) => {
      const h = harness({ usesTouch: true });
      await h.executeAction({ type: "click", x: 10, y: 20, ...extra });

      expect(h.click).toHaveBeenCalled();
      expect(h.tap).not.toHaveBeenCalled();
    },
  );

  describe("recording", () => {
    it("records a tap step so a cached mobile run replays as touch", async () => {
      const h = harness({ usesTouch: true, recording: true });
      await h.executeAction({ type: "click", x: 10, y: 20 });

      expect(h.tap).toHaveBeenCalledWith(10, 20, { returnXpath: true });
      expect(h.recorded[0]?.actions?.[0]?.method).toBe("tap");
      expect(h.recorded[0]?.actions?.[0]?.selector).toContain(
        "/html/body/button",
      );
    });

    it("records a click step on desktop", async () => {
      const h = harness({ usesTouch: false, recording: true });
      await h.executeAction({ type: "click", x: 10, y: 20 });

      expect(h.recorded[0]?.actions?.[0]?.method).toBe("click");
    });
  });
});
