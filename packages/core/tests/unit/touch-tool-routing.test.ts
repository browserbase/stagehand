import { describe, expect, it, vi } from "vitest";
import { clickTool } from "../../lib/v3/agent/tools/click.js";
import { typeTool } from "../../lib/v3/agent/tools/type.js";
import { fillFormVisionTool } from "../../lib/v3/agent/tools/fillFormVision.js";
import type { V3 } from "../../lib/v3/v3.js";
import type { Action } from "../../lib/v3/types/public/methods.js";

// A tool's `execute` only needs a page that records which input kind it was asked
// for, so the routing decision can be asserted without a browser.
function harness(opts: { usesTouch: boolean; recording?: boolean }) {
  type Pointer = (x: number, y: number, o?: unknown) => Promise<string>;
  const tap = vi.fn<Pointer>(async () => "/html/body/button");
  const click = vi.fn<Pointer>(async () => "/html/body/button");
  const type = vi.fn<(text: string) => Promise<void>>(async () => {});
  const recorded: Array<{ actions?: Action[] }> = [];

  const page = {
    tap,
    click,
    type,
    waitForTimeout: vi.fn(async () => {}),
    screenshot: vi.fn(async () => Buffer.from("png")),
  };

  const v3 = {
    usesTouch: opts.usesTouch,
    isVerified: false,
    configuredViewport: { width: 1288, height: 711 },
    isAgentReplayActive: () => opts.recording ?? false,
    recordAgentReplayStep: (step: { actions?: Action[] }) => {
      recorded.push(step);
    },
    logger: vi.fn(),
    context: { awaitActivePage: async () => page },
  } as unknown as V3;

  return { v3, tap, click, type, recorded };
}

// `tool()` wraps execute; the runtime always passes options, so supply a stub.
const run = async (t: unknown, args: unknown) =>
  (
    t as { execute: (args: unknown, opts: unknown) => Promise<unknown> }
  ).execute(args, { toolCallId: "t", messages: [] });

describe("hybrid tool touch routing", () => {
  describe("clickTool", () => {
    it("taps on a touch session", async () => {
      const h = harness({ usesTouch: true });
      await run(clickTool(h.v3), {
        describe: "size 42",
        coordinates: [10, 20],
      });
      expect(h.tap).toHaveBeenCalledWith(10, 20, { returnXpath: false });
      expect(h.click).not.toHaveBeenCalled();
    });

    it("clicks on a desktop session", async () => {
      const h = harness({ usesTouch: false });
      await run(clickTool(h.v3), {
        describe: "size 42",
        coordinates: [10, 20],
      });
      expect(h.click).toHaveBeenCalledWith(10, 20, { returnXpath: false });
      expect(h.tap).not.toHaveBeenCalled();
    });

    it("records a tap step so a cached mobile run replays as touch", async () => {
      const h = harness({ usesTouch: true, recording: true });
      await run(clickTool(h.v3), {
        describe: "size 42",
        coordinates: [10, 20],
      });
      expect(h.recorded[0]?.actions?.[0]?.method).toBe("tap");
    });

    it("records a click step on desktop", async () => {
      const h = harness({ usesTouch: false, recording: true });
      await run(clickTool(h.v3), {
        describe: "size 42",
        coordinates: [10, 20],
      });
      expect(h.recorded[0]?.actions?.[0]?.method).toBe("click");
    });
  });

  describe("typeTool", () => {
    it("taps to focus on a touch session, then types", async () => {
      const h = harness({ usesTouch: true });
      await run(typeTool(h.v3), {
        describe: "email field",
        coordinates: [5, 6],
        text: "a@b.co",
      });
      expect(h.tap).toHaveBeenCalledWith(5, 6, { returnXpath: false });
      expect(h.click).not.toHaveBeenCalled();
      expect(h.type).toHaveBeenCalledWith("a@b.co");
    });

    it("clicks to focus on a desktop session", async () => {
      const h = harness({ usesTouch: false });
      await run(typeTool(h.v3), {
        describe: "email field",
        coordinates: [5, 6],
        text: "a@b.co",
      });
      expect(h.click).toHaveBeenCalledWith(5, 6, { returnXpath: false });
      expect(h.tap).not.toHaveBeenCalled();
    });

    it("still records a type step, not a tap", async () => {
      const h = harness({ usesTouch: true, recording: true });
      await run(typeTool(h.v3), {
        describe: "email field",
        coordinates: [5, 6],
        text: "a@b.co",
      });
      expect(h.recorded[0]?.actions?.[0]?.method).toBe("type");
    });
  });

  describe("fillFormVisionTool", () => {
    const fields = [
      { action: "fill email", coordinates: { x: 1, y: 2 }, value: "a@b.co" },
      { action: "fill name", coordinates: { x: 3, y: 4 }, value: "ada" },
    ];

    it("taps every field on a touch session", async () => {
      const h = harness({ usesTouch: true });
      await run(fillFormVisionTool(h.v3), { fields });
      expect(h.tap.mock.calls.map((c) => [c[0], c[1]])).toEqual([
        [1, 2],
        [3, 4],
      ]);
      expect(h.click).not.toHaveBeenCalled();
    });

    it("clicks every field on a desktop session", async () => {
      const h = harness({ usesTouch: false });
      await run(fillFormVisionTool(h.v3), { fields });
      expect(h.click.mock.calls.map((c) => [c[0], c[1]])).toEqual([
        [1, 2],
        [3, 4],
      ]);
      expect(h.tap).not.toHaveBeenCalled();
    });
  });
});
