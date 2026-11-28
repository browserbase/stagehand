import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BROWSER_TOOLSET_DEFAULT_MEMBERS,
  BROWSER_TOOLSET_OPTIONAL_MEMBERS,
  StagehandCuaExecutor,
  UNSUPPORTED_TOOLSET_MEMBERS,
  buildBrowserToolsetDeclaration,
  buildClaudeCuaTranscript,
  chordToPlaywrightKey,
  compressTranscriptImages,
  isBrowserMemberEnabled,
  normalizeClaudeCuaModel,
  normalizeNavigationUrl,
  renderResultContent,
  runClaudeCuaSession,
  type ClaudeCuaSessionEvent,
  type CuaApiMessage,
  type CuaFacadeTools,
} from "../src/index.js";

const NUM_RUNS = (() => {
  const parsed = Number.parseInt(process.env.FC_NUM_RUNS ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 200;
})();

const FC_OPTS =
  process.env.FC_UNSEEDED === "1" ? { numRuns: NUM_RUNS } : { seed: 202604052, numRuns: NUM_RUNS };

const ASYNC_FC_OPTS =
  process.env.FC_UNSEEDED === "1"
    ? { numRuns: Math.min(NUM_RUNS, 200) }
    : { seed: 202604052, numRuns: Math.min(NUM_RUNS, 80) };

const logger = { log: () => {}, warn: () => {}, error: () => {} };

const PROTOTYPE_KEYS = [
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "valueOf",
  "hasOwnProperty",
] as const;

function makeFacade() {
  const calls: string[] = [];
  const tools: CuaFacadeTools = {
    run: async (code) => {
      calls.push(code);
      if (code.includes("return { tabs: __tabs")) {
        return {
          tabs: [{ tab_id: "p1", title: "Example", url: "https://example.com/", active: true }],
          extra: { url: "https://example.com/", tab_id: "p1" },
        };
      }
      return "UE5H";
    },
    runActions: async (actions) => ({ completed: actions.length, url: "https://example.com/" }),
    snapshot: async () => "[0-1] RootWebArea: Example\n  [0-2] button: Submit",
    screenshot: async () => ({ data: "UE5H", mimeType: "image/png" }),
  };
  return { calls, tools };
}

describe("claude-cua-sdk formal properties", () => {
  describe("executor coordinate, key, and URL safety", () => {
    it("chordToPlaywrightKey never leaks Object.prototype functions for prototype key names", () => {
      const chordArb = fc.oneof(
        fc.constantFrom(...PROTOTYPE_KEYS),
        fc
          .tuple(fc.constantFrom("ctrl", "shift", "alt", "cmd"), fc.constantFrom(...PROTOTYPE_KEYS))
          .map(([mod, key]) => `${mod}+${key}`),
        fc.string({ minLength: 1, maxLength: 30 }),
      );

      fc.assert(
        fc.property(chordArb, (chord) => {
          const mapped = chordToPlaywrightKey(chord);
          expect(typeof mapped).toBe("string");
          expect(mapped).not.toContain("[native code]");
          expect(mapped).not.toContain("function ");
        }),
        FC_OPTS,
      );
    });

    it("normalizeNavigationUrl only accepts http/https URLs and rejects all dangerous schemes", () => {
      const badSchemeArb = fc.constantFrom(
        "javascript:alert(1)",
        "data:text/html,<script>",
        "file:///etc/passwd",
        "chrome://settings",
        "about:blank",
        "vbscript:msgbox(1)",
      );

      fc.assert(
        fc.property(badSchemeArb, (url) => {
          expect(() => normalizeNavigationUrl(url)).toThrow();
        }),
        FC_OPTS,
      );

      fc.assert(
        fc.property(
          fc.stringMatching(/^[a-z0-9-]{1,12}\.(com|org|test)$/),
          fc.constantFrom("", "http://", "https://"),
          (host, scheme) => {
            const normalized = normalizeNavigationUrl(`${scheme}${host}`);
            const parsed = new URL(normalized);
            expect(["http:", "https:"]).toContain(parsed.protocol);
          },
        ),
        FC_OPTS,
      );
    });

    it("rejects empty/whitespace numeric strings, NaN, Infinity, and negative/overflow zoom clips", async () => {
      const badCoordArb = fc.oneof(
        fc.constant(""),
        fc.constant("   "),
        fc.constant("\t\n"),
        fc.constant(Number.NaN),
        fc.constant(Number.POSITIVE_INFINITY),
        fc.constant(Number.NEGATIVE_INFINITY),
        fc.constant(null),
        fc.constant(undefined),
      );

      await fc.assert(
        fc.asyncProperty(badCoordArb, async (bad) => {
          const facade = makeFacade();
          const exec = new StagehandCuaExecutor({ tools: facade.tools, logger });
          const res = await exec.execute(
            "left_click",
            { target: { type: "coordinate", x: bad, y: 10 } },
            { toolUseId: "tu_bad" },
          );
          expect(res.isError).toBe(true);
          expect(facade.calls).toEqual([]);
        }),
        ASYNC_FC_OPTS,
      );

      const badRegionArb = fc.oneof(
        fc.tuple(
          fc.double({ min: -1000, max: -0.01, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: 10, max: 500, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: 110, max: 500, noNaN: true, noDefaultInfinity: true }),
        ),
        fc.constant([-1e308, 0, 1e308, 100]),
        fc.constant([0, 0, Number.POSITIVE_INFINITY, 100]),
        fc.constant([100, 100, 50, 200]),
        fc.constant([0, 0, 0, 100]),
      );

      await fc.assert(
        fc.asyncProperty(badRegionArb, async (region) => {
          const facade = makeFacade();
          const exec = new StagehandCuaExecutor({ tools: facade.tools, logger });
          const res = await exec.execute("zoom", { region }, { toolUseId: "tu_zoom" });
          expect(res.isError).toBe(true);
          expect(facade.calls).toEqual([]);
        }),
        ASYNC_FC_OPTS,
      );
    });

    function assertFiniteCuaNumericOperands(code: string): void {
      for (const line of code.split("\n")) {
        const clickMatch = /^await batchStagehand\.page\.click\(([^,]+),\s*([^,)]+)/.exec(line);
        if (clickMatch) {
          expect(Number.isFinite(Number(clickMatch[1]!.trim()))).toBe(true);
          expect(Number.isFinite(Number(clickMatch[2]!.trim()))).toBe(true);
          continue;
        }
        const hoverMatch = /^await batchStagehand\.page\.hover\(([^,]+),\s*([^)]+)\);$/.exec(line);
        if (hoverMatch) {
          expect(Number.isFinite(Number(hoverMatch[1]!.trim()))).toBe(true);
          expect(Number.isFinite(Number(hoverMatch[2]!.trim()))).toBe(true);
          continue;
        }
        const dragMatch =
          /^await batchStagehand\.page\.dragAndDrop\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),/.exec(
            line,
          );
        if (dragMatch) {
          for (let i = 1; i <= 4; i += 1) {
            expect(Number.isFinite(Number(dragMatch[i]!.trim()))).toBe(true);
          }
          continue;
        }
        const scrollMatch =
          /^await batchStagehand\.page\.scroll\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\);$/.exec(
            line,
          );
        if (scrollMatch) {
          const xRaw = scrollMatch[1]!.trim();
          const yRaw = scrollMatch[2]!.trim();
          if (xRaw !== "Math.round(__vp.w / 2)") {
            expect(Number.isFinite(Number(xRaw))).toBe(true);
          }
          if (yRaw !== "Math.round(__vp.h / 2)") {
            expect(Number.isFinite(Number(yRaw))).toBe(true);
          }
          expect(Number.isFinite(Number(scrollMatch[3]!.trim()))).toBe(true);
          expect(Number.isFinite(Number(scrollMatch[4]!.trim()))).toBe(true);
          continue;
        }
        const waitMatch = /^await page\.waitForTimeout\(([^)]+)\);$/.exec(line);
        if (waitMatch) {
          const ms = Number(waitMatch[1]!.trim());
          expect(Number.isFinite(ms)).toBe(true);
          expect(ms).toBeGreaterThanOrEqual(0);
          expect(ms).toBeLessThanOrEqual(30_000);
          continue;
        }
        const zoomMatch =
          /clip:\s*\{\s*x:\s*([^,]+),\s*y:\s*([^,]+),\s*width:\s*([^,]+),\s*height:\s*([^}]+)\}/.exec(
            line,
          );
        if (zoomMatch) {
          const [x, y, width, height] = zoomMatch.slice(1, 5).map((v) => Number(v.trim()));
          expect(Number.isFinite(x) && x! >= 0).toBe(true);
          expect(Number.isFinite(y) && y! >= 0).toBe(true);
          expect(Number.isFinite(width) && width! > 0).toBe(true);
          expect(Number.isFinite(height) && height! > 0).toBe(true);
        }
      }
    }

    it("never throws unhandled exceptions for arbitrary member names and malformed inputs", async () => {
      const memberArb = fc.oneof(
        fc.constantFrom(
          ...BROWSER_TOOLSET_DEFAULT_MEMBERS,
          ...BROWSER_TOOLSET_OPTIONAL_MEMBERS,
          ...UNSUPPORTED_TOOLSET_MEMBERS,
          "unknown_member",
          "__proto__",
        ),
        fc.string({ maxLength: 20 }),
      );

      const inputArb = fc.dictionary(
        fc.constantFrom(
          "x",
          "y",
          "target",
          "from",
          "coordinate",
          "region",
          "url",
          "text",
          "repeat",
          "duration",
          "scroll_direction",
          "scroll_amount",
          "filter",
          "depth",
          "query",
          "value",
          "modifiers",
          "tab_id",
        ),
        fc.oneof(
          fc.string({ maxLength: 20 }),
          fc.double({ noNaN: false, noDefaultInfinity: false }),
          fc.boolean(),
          fc.constant(null),
          fc.array(fc.double({ noNaN: false, noDefaultInfinity: false }), { maxLength: 5 }),
          fc.record({
            type: fc.constantFrom("coordinate", "ref", "bogus"),
            x: fc.double({ noNaN: false, noDefaultInfinity: false }),
            y: fc.double({ noNaN: false, noDefaultInfinity: false }),
            ref: fc.string({ maxLength: 10 }),
          }),
        ),
        { maxKeys: 5 },
      );

      await fc.assert(
        fc.asyncProperty(memberArb, inputArb, async (member, input) => {
          const facade = makeFacade();
          const exec = new StagehandCuaExecutor({ tools: facade.tools, logger });
          const result = await exec.execute(member, input, { toolUseId: "tu_fuzz" });
          expect(typeof result.content === "string" || Array.isArray(result.content)).toBe(true);
          for (const code of facade.calls) {
            assertFiniteCuaNumericOperands(code);
          }
        }),
        ASYNC_FC_OPTS,
      );
    });

    it("allows valid javascript_exec scripts containing NaN or Infinity while keeping numeric action operands finite", async () => {
      const facade = makeFacade();
      const exec = new StagehandCuaExecutor({ tools: facade.tools, logger });
      const script = "return Number.isNaN(NaN) && !Number.isFinite(Infinity);";
      const jsRes = await exec.execute("javascript_exec", { text: script }, { toolUseId: "tu_js" });
      expect(jsRes.isError).toBeUndefined();
      expect(facade.calls[0]).toContain(JSON.stringify(script));

      const coordArb = fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true });
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            "left_click",
            "hover",
            "mouse_move",
            "left_click_drag",
            "scroll",
            "zoom",
            "wait",
          ),
          coordArb,
          coordArb,
          coordArb,
          coordArb,
          fc.double({ min: 0, max: 1000, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: 1, max: 1000, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: -10, max: 100, noNaN: true, noDefaultInfinity: true }),
          async (member, x0, y0, x1, y1, origin, span, duration) => {
            const actionFacade = makeFacade();
            const actionExec = new StagehandCuaExecutor({ tools: actionFacade.tools, logger });
            const input: Record<string, unknown> =
              member === "left_click_drag"
                ? {
                    from: { type: "coordinate", x: x0, y: y0 },
                    target: { type: "coordinate", x: x1, y: y1 },
                  }
                : member === "scroll"
                  ? {
                      target: { type: "coordinate", x: x0, y: y0 },
                      scroll_direction: "down",
                      scroll_amount: duration,
                    }
                  : member === "zoom"
                    ? { region: [origin, origin, origin + span, origin + span] }
                    : member === "wait"
                      ? { duration }
                      : { target: { type: "coordinate", x: x0, y: y0 } };
            const res = await actionExec.execute(member, input, { toolUseId: "tu_op" });
            expect(res.isError).toBeUndefined();
            expect(actionFacade.calls.length).toBeGreaterThan(0);
            for (const code of actionFacade.calls) {
              assertFiniteCuaNumericOperands(code);
            }
          },
        ),
        ASYNC_FC_OPTS,
      );
    });
  });

  describe("toolset config and model normalization", () => {
    it("merges overrides safely without prototype pollution", () => {
      const memberArb = fc.oneof(
        fc.constantFrom(...BROWSER_TOOLSET_DEFAULT_MEMBERS, ...BROWSER_TOOLSET_OPTIONAL_MEMBERS),
        fc.constantFrom(...PROTOTYPE_KEYS),
      );

      fc.assert(
        fc.property(
          memberArb,
          fc.option(fc.boolean(), { nil: undefined }),
          fc.option(fc.boolean(), { nil: undefined }),
          (member, enabled, deferLoading) => {
            const overrides = {
              [member]: {
                ...(enabled !== undefined && { enabled }),
                ...(deferLoading !== undefined && { defer_loading: deferLoading }),
              },
            };
            const decl = buildBrowserToolsetDeclaration(overrides);
            expect(decl.type).toBe("browser_toolset_20260801");
            const isEnabled = isBrowserMemberEnabled(member, overrides);
            expect(typeof isEnabled).toBe("boolean");
            if (enabled !== undefined) {
              expect(isEnabled).toBe(enabled);
            }
          },
        ),
        FC_OPTS,
      );

      fc.assert(
        fc.property(fc.string(), (model) => {
          const normalized = normalizeClaudeCuaModel(model);
          expect(typeof normalized).toBe("string");
          if (!model.includes("/")) expect(normalized).toBe(model);
        }),
        FC_OPTS,
      );
    });
  });

  describe("transcript pruning, surrogate safety, and tool-use/tool-result pairing", () => {
    it("compressTranscriptImages always bounds remaining images even for negative/fractional/NaN budgets", () => {
      const keepArb = fc.oneof(
        fc.integer({ min: -10, max: 15 }),
        fc.double({ min: -5, max: 10, noNaN: false, noDefaultInfinity: false }),
        fc.constant(Number.NaN),
      );

      fc.assert(
        fc.property(fc.integer({ min: 0, max: 15 }), keepArb, (imageCount, keep) => {
          const messages = Array.from({ length: imageCount }, (_, i) => ({
            role: "user" as const,
            content: [
              {
                type: "tool_result",
                tool_use_id: `tu_${i}`,
                content: [
                  {
                    type: "image",
                    source: { type: "base64", media_type: "image/png", data: `img_${i}` },
                  },
                ],
              },
            ],
          }));

          compressTranscriptImages(messages, keep);

          const remainingImages: string[] = [];
          for (const msg of messages) {
            for (const block of msg.content) {
              for (const inner of block.content) {
                if (inner.type === "image") {
                  remainingImages.push((inner as { source: { data: string } }).source.data);
                }
              }
            }
          }

          const expectedKeep = Number.isFinite(keep)
            ? Math.min(imageCount, Math.max(0, Math.floor(keep)))
            : keep === Number.POSITIVE_INFINITY
              ? imageCount
              : 0;
          expect(remainingImages.length).toBe(expectedKeep);
          expect(remainingImages).toEqual(
            Array.from({ length: expectedKeep }, (_, k) => `img_${imageCount - expectedKeep + k}`),
          );
        }),
        FC_OPTS,
      );
    });

    it("buildClaudeCuaTranscript clips long Unicode/emoji results without corrupting UTF-16 pairs", () => {
      const textArb = fc.string({ minLength: 0, maxLength: 2500 });
      const emojiTextArb = fc
        .tuple(fc.integer({ min: 1990, max: 2005 }), fc.string({ maxLength: 50 }))
        .map(([n, tail]) => `${"a".repeat(n)}😀🚀${tail}`);

      fc.assert(
        fc.property(fc.oneof(textArb, emojiTextArb), fc.boolean(), (text, isError) => {
          const events: ClaudeCuaSessionEvent[] = [
            {
              type: "tool_result",
              turn: 1,
              toolUseId: "tu_1",
              name: "read_page",
              content: text,
              isError,
              durationMs: 1,
            },
          ];
          const transcript = buildClaudeCuaTranscript(events);
          expect(transcript).toContain('<tool_result name="read_page"');
          expect(transcript.endsWith("</tool_result>")).toBe(true);
          expect(Buffer.from(transcript, "utf8").toString("utf8")).toBe(transcript);
          expect(renderResultContent(text)).toBe(text);
        }),
        FC_OPTS,
      );
    });

    it("runClaudeCuaSession maintains exact 1:1 tool_use to tool_result pairing and order", async () => {
      const turnSpecArb = fc.array(
        fc.array(
          fc.record({
            id: fc.stringMatching(/^tu_[a-z0-9]{1,8}$/),
            name: fc.constantFrom("screenshot", "navigate", "unknown_tool", "left_click"),
            fails: fc.boolean(),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        { minLength: 1, maxLength: 4 },
      );

      await fc.assert(
        fc.asyncProperty(turnSpecArb, async (turnsSpec) => {
          const failMap = new Map<string, boolean>();
          const responses: CuaApiMessage[] = turnsSpec.map((blocks, tIdx) => ({
            content: blocks.map((b, bIdx) => {
              const uniqueId = `${b.id}_${tIdx}_${bIdx}`;
              failMap.set(uniqueId, b.fails);
              return {
                type: "tool_use",
                id: uniqueId,
                name: b.name,
                ...(b.name !== "unknown_tool" && { toolset_name: "browser" }),
                input: {},
              };
            }),
            stop_reason: "tool_use",
            usage: { input_tokens: 10, output_tokens: 5 },
          }));
          responses.push({
            content: [{ type: "text", text: "done" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 4, output_tokens: 2 },
          });

          const sentRequests: Array<Record<string, unknown>> = [];
          const result = await runClaudeCuaSession({
            prompt: "start",
            model: "anthropic/claude-sonnet-5",
            logger,
            maxTurns: turnsSpec.length + 2,
            client: {
              create: async (params) => {
                sentRequests.push(structuredClone(params));
                return responses.shift()!;
              },
            },
            tools: {
              execute: async (_member, _input, ctx) =>
                failMap.get(ctx.toolUseId)
                  ? { content: "Error: boom", isError: true }
                  : { content: "ok" },
            },
          });

          expect(result.status).toBe("completed");
          const toolUses = result.events.filter((e) => e.type === "tool_use");
          const toolResults = result.events.filter((e) => e.type === "tool_result");
          expect(toolUses.length).toBe(toolResults.length);
          expect(toolUses.map((u) => u.id)).toEqual(toolResults.map((r) => r.toolUseId));
          expect(result.toolCalls).toBe(toolUses.length);

          const finalMessages = sentRequests.at(-1)!.messages as Array<{
            role: string;
            content: unknown;
          }>;
          for (let i = 1; i < finalMessages.length; i += 2) {
            const assistantMsg = finalMessages[i]!;
            const userMsg = finalMessages[i + 1]!;
            const useIds = (assistantMsg.content as Array<Record<string, unknown>>)
              .filter((b) => b.type === "tool_use")
              .map((b) => b.id);
            const resIds = (userMsg.content as Array<Record<string, unknown>>)
              .filter((b) => b.type === "tool_result")
              .map((b) => b.tool_use_id);
            expect(resIds).toEqual(useIds);
          }

          expect(result.tokenUsage.total).toBe(
            result.tokenUsage.input +
              result.tokenUsage.output +
              result.tokenUsage.cache_read +
              result.tokenUsage.cache_creation,
          );
        }),
        ASYNC_FC_OPTS,
      );
    });
  });
});
