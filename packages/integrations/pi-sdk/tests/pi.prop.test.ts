import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MAX_PI_IMAGE_BYTES,
  buildPiMcpToolName,
  buildPiTranscript,
  compactPiEvent,
  extractPiTokenUsage,
  isPiMcpToolName,
  mcpCallResultToPiToolResult,
  piToolResultText,
  withoutImageData,
  type PiEvent,
} from "../src/index.js";

const NUM_RUNS = (() => {
  const parsed = Number.parseInt(process.env.FC_NUM_RUNS ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 200;
})();

const FC_OPTS =
  process.env.FC_UNSEEDED === "1" ? { numRuns: NUM_RUNS } : { seed: 202604057, numRuns: NUM_RUNS };

describe("pi-sdk formal properties", () => {
  it("extractPiTokenUsage never returns negative or non-finite counters", () => {
    const rawNumArb = fc.oneof(
      fc.constant(undefined),
      fc.constant(null),
      fc.double({ min: -1000, max: 1e6, noNaN: false, noDefaultInfinity: false }),
      fc.integer({ min: -100, max: 100_000 }).map(String),
      fc.constant("NaN"),
      fc.constant("Infinity"),
    );

    const eventArb: fc.Arbitrary<PiEvent> = fc.record({
      type: fc.constant("message_end"),
      message: fc.record({
        role: fc.constantFrom("assistant", "user", "toolResult"),
        usage: fc.record({
          input: rawNumArb,
          output: rawNumArb,
          cacheRead: rawNumArb,
          cacheWrite: rawNumArb,
          reasoning: rawNumArb,
          totalTokens: rawNumArb,
          cost: fc.record({ total: rawNumArb }),
        }),
      }),
    });

    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 10 }), (events) => {
        const usage = extractPiTokenUsage(events);
        for (const value of [
          usage.inputTokens,
          usage.outputTokens,
          usage.cacheReadTokens,
          usage.cacheWriteTokens,
          usage.totalTokens,
          usage.costUsd,
          ...(usage.reasoningTokens !== undefined ? [usage.reasoningTokens] : []),
        ]) {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        }
      }),
      FC_OPTS,
    );
  });

  it("compactPiEvent strictly enforces the session image byte budget and strips base64 from non-assistant messages", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4096 }),
        fc.array(fc.integer({ min: 1, max: 1024 }), { minLength: 1, maxLength: 8 }),
        (initialBudget, byteSizes) => {
          const budget = { remainingBytes: initialBudget };
          let totalRetained = 0;

          for (const size of byteSizes) {
            const payload = Buffer.alloc(size, 42).toString("base64");
            const compacted = compactPiEvent(
              {
                type: "tool_execution_end",
                toolName: "screenshot",
                result: {
                  content: [{ type: "image", data: payload, mimeType: "image/png" }],
                },
              },
              budget,
            );
            const block = (compacted.result as { content: Array<Record<string, unknown>> })
              .content[0]!;
            if (Buffer.isBuffer(block.bytes)) {
              expect(block.bytes.byteLength).toBeLessThanOrEqual(MAX_PI_IMAGE_BYTES);
              totalRetained += block.bytes.byteLength;
              expect(block.data).toBeUndefined();
            } else {
              expect(block.type).toBe("text");
            }
          }

          expect(totalRetained).toBeLessThanOrEqual(initialBudget);
          expect(budget.remainingBytes).toBe(initialBudget - totalRetained);
          expect(budget.remainingBytes).toBeGreaterThanOrEqual(0);
        },
      ),
      FC_OPTS,
    );
  });

  it("buildPiMcpToolName / isPiMcpToolName round-trip and mcpCallResultToPiToolResult is total", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (server, tool) => {
          const fullName = buildPiMcpToolName(server, tool);
          expect(isPiMcpToolName(fullName)).toBe(true);
          expect(isPiMcpToolName(fullName, server)).toBe(true);
          expect(fullName).toMatch(/^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$/);
        },
      ),
      FC_OPTS,
    );

    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({ type: fc.constant("text"), text: fc.string({ maxLength: 50 }) }),
            fc.record({
              type: fc.constant("image"),
              data: fc.string({ maxLength: 30 }),
              mimeType: fc.constant("image/png"),
            }),
            fc.anything(),
          ),
          { maxLength: 8 },
        ),
        fc.anything(),
        (content, isError) => {
          const mapped = mcpCallResultToPiToolResult({ content, isError });
          expect(mapped.content).toHaveLength(content.length);
          expect(mapped.isError).toBe(isError === true);
          expect(typeof piToolResultText(mapped)).toBe("string");
          const scrubbed = withoutImageData(mapped);
          expect(scrubbed).toBeDefined();
        },
      ),
      FC_OPTS,
    );
  });

  it("buildPiTranscript never leaks known secret formats", () => {
    const secretArb = fc.oneof(
      fc.stringMatching(/^sk-[A-Za-z0-9]{12,24}$/),
      fc.stringMatching(/^bb_live_[A-Za-z0-9]{10,20}$/),
    );

    fc.assert(
      fc.property(secretArb, (secret) => {
        const transcript = buildPiTranscript([
          { type: "tool_execution_end", toolName: "run", result: { error: `leaked ${secret}` } },
        ]);
        expect(transcript).not.toContain(secret);
      }),
      FC_OPTS,
    );
  });
});
