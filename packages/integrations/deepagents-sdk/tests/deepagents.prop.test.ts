import { PassThrough } from "node:stream";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildDeepagentsTranscript,
  extractDeepagentsTokenUsage,
  normalizeDeepagentsModel,
  resolveDeepagentsStatus,
  runDeepagentsSession,
  type DeepagentsProcessSpawner,
} from "../src/index.js";

const NUM_RUNS = (() => {
  const parsed = Number.parseInt(process.env.FC_NUM_RUNS ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 200;
})();

const FC_OPTS =
  process.env.FC_UNSEEDED === "1" ? { numRuns: NUM_RUNS } : { seed: 202604058, numRuns: NUM_RUNS };

const ASYNC_FC_OPTS =
  process.env.FC_UNSEEDED === "1"
    ? { numRuns: Math.min(NUM_RUNS, 120) }
    : { seed: 202604058, numRuns: Math.min(NUM_RUNS, 50) };

const logger = { log: () => {}, warn: () => {}, error: () => {} };

describe("deepagents-sdk formal properties", () => {
  it("extractDeepagentsTokenUsage always produces finite non-negative token counts", () => {
    const rawNumArb = fc.oneof(
      fc.constant(undefined),
      fc.constant(null),
      fc.double({ min: -1000, max: 1e7, noNaN: false, noDefaultInfinity: false }),
      fc.integer({ min: -100, max: 100_000 }).map(String),
      fc.constant("NaN"),
    );

    fc.assert(
      fc.property(
        fc.record({
          reported: fc.option(fc.boolean(), { nil: undefined }),
          input_tokens: rawNumArb,
          output_tokens: rawNumArb,
          cache_read_input_tokens: rawNumArb,
          reasoning_output_tokens: rawNumArb,
          total_tokens: rawNumArb,
        }),
        (event) => {
          const usage = extractDeepagentsTokenUsage(event);
          for (const val of [
            usage.inputTokens,
            usage.outputTokens,
            usage.cacheReadInputTokens,
            usage.reasoningOutputTokens,
            usage.totalTokens,
          ]) {
            expect(Number.isFinite(val)).toBe(true);
            expect(val).toBeGreaterThanOrEqual(0);
          }
          if (event.reported === false) {
            expect(usage.reported).toBe(false);
          }
        },
      ),
      FC_OPTS,
    );
  });

  it("normalizeDeepagentsModel is idempotent and resolveDeepagentsStatus is total", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (model) => {
        const once = normalizeDeepagentsModel(model);
        const twice = normalizeDeepagentsModel(once);
        expect(twice).toBe(once);
      }),
      FC_OPTS,
    );

    fc.assert(
      fc.property(
        fc.option(fc.constantFrom("recursion_limit", "tool_step_budget", "exception"), {
          nil: undefined,
        }),
        fc.option(fc.integer({ min: 0, max: 2 }), { nil: null }),
        fc.option(fc.constantFrom("SIGTERM" as const, "SIGKILL" as const), { nil: null }),
        fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
        fc.boolean(),
        (errorKind, exitCode, signal, iterationError, sawTerminalEvents) => {
          const status = resolveDeepagentsStatus({
            errorKind,
            exitCode,
            signal,
            iterationError,
            sawTerminalEvents,
          });
          expect(["completed", "max_turns", "sdk_error"]).toContain(status);
          if (iterationError || exitCode !== 0 || signal !== null || !sawTerminalEvents) {
            expect(status).toBe("sdk_error");
          }
        },
      ),
      FC_OPTS,
    );
  });

  it("runDeepagentsSession ignores malformed JSONL and JSON arrays on stdout without crashing or leaking secrets", async () => {
    const secretArb = fc.stringMatching(/^sk-[A-Za-z0-9]{12,24}$/);
    const noiseLineArb = fc.oneof(
      fc.string({ maxLength: 80 }).filter((s) => !s.includes("\n") && !s.includes("\r")),
      fc.constant("[1, 2, 3]"),
      fc.constant("[]"),
      fc.constant("null"),
      fc.constant('{"truncated": '),
    );

    await fc.assert(
      fc.asyncProperty(
        fc.array(noiseLineArb, { maxLength: 6 }),
        secretArb,
        async (noiseLines, secret) => {
          const spawner: DeepagentsProcessSpawner = () => {
            const stdin = new PassThrough();
            const stdout = new PassThrough();
            const stderr = new PassThrough();
            let resolveExit!: (v: { code: number | null; signal: NodeJS.Signals | null }) => void;
            const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
              (resolve) => {
                resolveExit = resolve;
              },
            );
            queueMicrotask(() => {
              for (const line of noiseLines) stdout.write(`${line}\n`);
              stdout.write(
                `${JSON.stringify({ type: "tool_result", name: "run", ok: false, error: secret })}\n`,
              );
              stdout.write(`${JSON.stringify({ type: "final", text: "done" })}\n`);
              stdout.write(
                `${JSON.stringify({ type: "usage", input_tokens: 10, output_tokens: 5 })}\n`,
              );
              stdout.end();
              stderr.end();
              resolveExit({ code: 0, signal: null });
            });
            return { stdin, stdout, stderr, exited, kill: () => {} };
          };

          const result = await runDeepagentsSession({
            prompt: "task",
            model: "openai/gpt-5.4-mini",
            logger,
            spawn: spawner,
            session: {},
          });

          for (const event of result.events) {
            expect(Array.isArray(event)).toBe(false);
          }
          expect(JSON.stringify(result.events)).not.toContain(secret);
          expect(buildDeepagentsTranscript(result.events)).not.toContain(secret);
        },
      ),
      ASYNC_FC_OPTS,
    );
  });
});
