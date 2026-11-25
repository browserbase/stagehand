import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildCursorTranscript,
  extractCursorToolCall,
  parseCursorStreamLine,
  summarizeCursorEvent,
  type CursorEvent,
} from "../src/events.js";

const NUM_RUNS = (() => {
  const parsed = Number.parseInt(process.env.FC_NUM_RUNS ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 200;
})();

const FC_OPTS =
  process.env.FC_UNSEEDED === "1" ? { numRuns: NUM_RUNS } : { seed: 202604056, numRuns: NUM_RUNS };

describe("cursor event stream formal properties", () => {
  it("parseCursorStreamLine only returns plain non-array objects and never throws on malformed JSONL", () => {
    const lineArb = fc.oneof(
      fc.string({ maxLength: 300 }),
      fc.json(),
      fc.array(fc.anything(), { maxLength: 5 }).map((arr) => JSON.stringify(arr)),
      fc.dictionary(fc.string({ maxLength: 10 }), fc.jsonValue(), { maxKeys: 5 }).map((obj) => {
        const raw = JSON.stringify(obj);
        return raw.slice(0, Math.floor(raw.length / 2));
      }),
    );

    fc.assert(
      fc.property(lineArb, (line) => {
        const parsed = parseCursorStreamLine(line);
        if (parsed !== undefined) {
          expect(typeof parsed).toBe("object");
          expect(parsed).not.toBeNull();
          expect(Array.isArray(parsed)).toBe(false);
        }
      }),
      FC_OPTS,
    );
  });

  it("extractCursorToolCall rejects array tool_call/args envelopes and normalizes valid MCP results", () => {
    const toolCallEventArb = fc.oneof(
      fc.constant({ type: "tool_call", tool_call: [{ args: { a: 1 } }] } as CursorEvent),
      fc.constant({
        type: "tool_call",
        tool_call: { function: { name: "fn", arguments: "[1,2,3]" } },
      } as CursorEvent),
      fc.record({
        type: fc.constant("tool_call"),
        subtype: fc.oneof(fc.constant("started"), fc.constant("completed"), fc.string()),
        call_id: fc.oneof(fc.string({ maxLength: 20 }), fc.integer()),
        tool_call: fc.oneof(
          fc.record({
            mcpToolCall: fc.record({
              args: fc.record({
                providerIdentifier: fc.oneof(fc.constant(""), fc.string({ maxLength: 15 })),
                server: fc.oneof(
                  fc.string({ minLength: 1, maxLength: 15 }),
                  fc.constant(undefined),
                ),
                name: fc.oneof(fc.constant(""), fc.string({ maxLength: 15 })),
                toolName: fc.oneof(
                  fc.string({ minLength: 1, maxLength: 15 }),
                  fc.constant(undefined),
                ),
                args: fc.oneof(
                  fc.dictionary(fc.string({ maxLength: 8 }), fc.jsonValue(), { maxKeys: 3 }),
                  fc.array(fc.integer(), { maxLength: 3 }),
                ),
              }),
              result: fc.oneof(
                fc.record({
                  success: fc.record({
                    isError: fc.option(fc.boolean(), { nil: undefined }),
                    content: fc.array(
                      fc.oneof(
                        fc.record({ text: fc.record({ text: fc.string({ maxLength: 30 }) }) }),
                        fc.record({
                          image: fc.record({
                            data: fc.string({ maxLength: 20 }),
                            mimeType: fc.constant("image/png"),
                          }),
                        }),
                        fc.record({
                          type: fc.constant("text"),
                          text: fc.string({ maxLength: 20 }),
                        }),
                      ),
                      { maxLength: 4 },
                    ),
                  }),
                }),
                fc.record({ error: fc.string({ maxLength: 40 }) }),
                fc.record({ rejected: fc.string({ maxLength: 40 }) }),
                fc.array(fc.string(), { maxLength: 2 }),
              ),
            }),
          }),
          fc.record({
            function: fc.record({
              name: fc.oneof(fc.string({ maxLength: 15 }), fc.integer()),
              arguments: fc.oneof(
                fc.json(),
                fc.string({ maxLength: 30 }),
                fc.dictionary(fc.string({ maxLength: 8 }), fc.jsonValue(), { maxKeys: 3 }),
                fc.array(fc.integer(), { maxLength: 3 }),
              ),
            }),
          }),
        ),
      }) as fc.Arbitrary<CursorEvent>,
    );

    fc.assert(
      fc.property(toolCallEventArb, (event) => {
        const view = extractCursorToolCall(event);
        if (Array.isArray(event.tool_call)) {
          expect(view).toBeUndefined();
          return;
        }
        if (view !== undefined) {
          expect(typeof view.callId).toBe("string");
          expect(typeof view.kind).toBe("string");
          expect(typeof view.name).toBe("string");
          expect(typeof view.args).toBe("object");
          expect(view.args).not.toBeNull();
          expect(Array.isArray(view.args)).toBe(false);
          expect(typeof view.ok).toBe("boolean");
        }
      }),
      FC_OPTS,
    );
  });

  it("summarizeCursorEvent and buildCursorTranscript never throw on arbitrary/null-prototype events", () => {
    const weirdEventArb = fc.oneof(
      fc.dictionary(fc.string({ maxLength: 12 }), fc.anything(), { maxKeys: 6 }),
      fc.constant({ type: Object.create(null), subtype: Object.create(null) } as CursorEvent),
      fc.record({
        type: fc.constant("assistant"),
        message: fc.record({
          content: fc.array(
            fc.oneof(
              fc.record({ type: fc.constant("text"), text: fc.string({ maxLength: 600 }) }),
              fc.constant(null),
              fc.integer(),
            ),
            { maxLength: 5 },
          ),
        }),
      }) as fc.Arbitrary<CursorEvent>,
    );

    fc.assert(
      fc.property(fc.array(weirdEventArb, { maxLength: 10 }), (events) => {
        for (const event of events) {
          const summary = summarizeCursorEvent(event);
          expect(typeof summary.message).toBe("string");
        }
        const transcript = buildCursorTranscript(events);
        expect(typeof transcript).toBe("string");
      }),
      FC_OPTS,
    );
  });
});
