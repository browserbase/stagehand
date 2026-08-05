import { describe, expect, it } from "vitest";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  denormalizeCoordinates,
  estimateMessagesSizeBytes,
  formatStopAndSummarize,
  formatTaskWithContext,
  mapNavigatorKeyToPlaywright,
  trimImagesToFit,
} from "../../lib/v3/agent/utils/yutoriActions.js";

describe("yutoriActions: denormalizeCoordinates", () => {
  it("maps the normalized 1000x1000 space to viewport pixels", () => {
    expect(denormalizeCoordinates([500, 500], 1280, 800)).toEqual({
      x: 640,
      y: 400,
    });
    expect(denormalizeCoordinates([0, 0], 1280, 800)).toEqual({ x: 0, y: 0 });
    // 333/1000*1280 = 426.24 -> 426 ; 333/1000*800 = 266.4 -> 266
    expect(denormalizeCoordinates([333, 333], 1280, 800)).toEqual({
      x: 426,
      y: 266,
    });
  });

  it("clamps to the viewport bounds [0, dim-1]", () => {
    // 1000/1000*1280 = 1280 -> clamped to 1279 (not an off-by-one out of bounds)
    expect(denormalizeCoordinates([1000, 1000], 1280, 800)).toEqual({
      x: 1279,
      y: 799,
    });
    // over-range and negative inputs clamp on both axes
    expect(denormalizeCoordinates([2000, -50], 1280, 800)).toEqual({
      x: 1279,
      y: 0,
    });
  });

  it("throws on malformed input instead of producing NaN coordinates", () => {
    expect(() => denormalizeCoordinates([500], 1280, 800)).toThrow();
    expect(() => denormalizeCoordinates([Number.NaN, 5], 1280, 800)).toThrow();
    expect(() =>
      denormalizeCoordinates(["a", 5] as unknown as number[], 1280, 800),
    ).toThrow();
    expect(() => denormalizeCoordinates([5, 5], 0, 800)).toThrow();
  });
});

describe("yutoriActions: mapNavigatorKeyToPlaywright", () => {
  it("joins simultaneous combos with + and maps modifier names", () => {
    expect(mapNavigatorKeyToPlaywright("ctrl+c")).toEqual(["Control+c"]);
    expect(mapNavigatorKeyToPlaywright("ctrl+shift+t")).toEqual([
      "Control+Shift+t",
    ]);
    expect(mapNavigatorKeyToPlaywright("shift")).toEqual(["Shift"]);
  });

  it("splits space-separated sequences into multiple presses", () => {
    expect(mapNavigatorKeyToPlaywright("down down enter")).toEqual([
      "ArrowDown",
      "ArrowDown",
      "Enter",
    ]);
  });

  it("maps function keys, word-form punctuation, numpad, and space", () => {
    expect(mapNavigatorKeyToPlaywright("f5")).toEqual(["F5"]);
    expect(mapNavigatorKeyToPlaywright("plus")).toEqual(["+"]);
    expect(mapNavigatorKeyToPlaywright("comma")).toEqual([","]);
    expect(mapNavigatorKeyToPlaywright("space")).toEqual([" "]);
    // numpad parity with the Yutori Python SDK key map
    expect(mapNavigatorKeyToPlaywright("numpad5")).toEqual(["5"]);
    expect(mapNavigatorKeyToPlaywright("numpadadd")).toEqual(["+"]);
    expect(mapNavigatorKeyToPlaywright("numpaddivide")).toEqual(["/"]);
  });

  it("passes unknown keys through unchanged", () => {
    expect(mapNavigatorKeyToPlaywright("zzz")).toEqual(["zzz"]);
  });
});

describe("yutoriActions: prompt formatting", () => {
  it("appends a user-context block (location/timezone) to the task", () => {
    const out = formatTaskWithContext(
      "do the thing",
      "America/New_York",
      "New York, NY, US",
    );
    expect(out).toContain("do the thing");
    expect(out).toContain("User's location: New York, NY, US");
    expect(out).toContain("User's timezone: America/New_York");
  });

  it("falls back to a valid timezone (does not throw) for an invalid tz", () => {
    expect(() => formatTaskWithContext("x", "Not/AZone")).not.toThrow();
    const out = formatTaskWithContext("x", "Not/AZone");
    expect(out).toContain("User's timezone: America/Los_Angeles");
  });

  it("formatStopAndSummarize embeds the task and the stop directive", () => {
    const out = formatStopAndSummarize("find the prices");
    expect(out).toContain("Stop here.");
    expect(out).toContain("find the prices");
  });
});

describe("yutoriActions: payload trimming", () => {
  function imageMessage(
    role: "user" | "tool",
    bytes: number,
  ): ChatCompletionMessageParam {
    return {
      role,
      content: [
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${"A".repeat(bytes)}` },
        },
      ],
    } as ChatCompletionMessageParam;
  }

  function imageCount(messages: ChatCompletionMessageParam[]): number {
    let n = 0;
    for (const m of messages) {
      if (Array.isArray(m.content)) {
        n += m.content.filter(
          (p) => (p as { type?: string }).type === "image_url",
        ).length;
      }
    }
    return n;
  }

  it("is a no-op when the payload is already under the limit", () => {
    const messages = [imageMessage("user", 100), imageMessage("tool", 100)];
    const before = imageCount(messages);
    const { removed } = trimImagesToFit(messages, 10_000_000, 6);
    expect(removed).toBe(0);
    expect(imageCount(messages)).toBe(before);
  });

  it("drops old screenshots but always keeps the most recent one", () => {
    const messages = [
      imageMessage("user", 2000),
      imageMessage("tool", 2000),
      imageMessage("tool", 2000),
      imageMessage("tool", 2000),
    ];
    const { removed, sizeBytes } = trimImagesToFit(messages, 3000, 1);
    expect(removed).toBeGreaterThan(0);
    // The latest screenshot is never stripped.
    expect(imageCount([messages[messages.length - 1]])).toBe(1);
    // A stripped image-only message gets a placeholder text part so it is
    // never left content-less.
    const placeholder = messages.some(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some(
          (p) =>
            (p as { type?: string; text?: string }).type === "text" &&
            String((p as { text?: string }).text).includes(
              "Screenshot omitted",
            ),
        ),
    );
    expect(placeholder).toBe(true);
    expect(sizeBytes).toBe(estimateMessagesSizeBytes(messages));
  });
});
