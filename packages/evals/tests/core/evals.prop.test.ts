import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createBrowseCliSessionName } from "../../browseCliPaths.js";
import {
  DEFAULT_EVAL_BROWSERBASE_SESSION_TIMEOUT_SECONDS,
  evalBooleanEnv,
  evalBrowserbaseSessionOptions,
  evalBrowserbaseSessionTimeoutSeconds,
} from "../../core/targets/browserbaseSessionOptions.js";
import {
  BROWSER_SESSION_LOST_ERROR_PREFIX,
  SESSION_LOST_TELEMETRY_PREFIX,
  browserSessionLostCause,
  isBrowserSessionLostError,
  parseSessionLossTelemetry,
} from "../../core/tools/browserSessionLoss.js";
import {
  extractMcpImage,
  extractMcpText,
  parseChromeDevtoolsListedPages,
  parseLooseJson,
  type McpToolResult,
} from "../../core/tools/mcpUtils.js";
import {
  computeListCost,
  modelPriceCandidates,
  providerOf,
  resolveBilledCost,
  resolveModelPrice,
  type PriceMap,
} from "../../framework/costEstimate.js";
import { createMetricsCollector } from "../../framework/metrics.js";
import {
  buildRunSummaryJson,
  classifyRowOutcome,
  isDeadJudgeRun,
  summarizeCells,
  summarizeGates,
  summarizeUsage,
  summarizeVerifier,
  type SummaryRow,
} from "../../framework/runSummary.js";
import {
  formatNormalizedUsage,
  normalizeUsage,
  usageConventionFor,
} from "../../framework/usageNormalization.js";

const NUM_RUNS = (() => {
  const parsed = Number.parseInt(process.env.FC_NUM_RUNS ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 200;
})();

const FC_OPTS =
  process.env.FC_UNSEEDED === "1" ? { numRuns: NUM_RUNS } : { seed: 202604051, numRuns: NUM_RUNS };

const PROTOTYPE_KEYS = [
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "valueOf",
  "hasOwnProperty",
] as const;

const prototypeOrStringArb = fc.oneof(fc.constantFrom(...PROTOTYPE_KEYS), fc.string());

describe("evals formal properties", () => {
  describe("mcpUtils", () => {
    it("round-trips valid JSON objects/arrays even when string values contain markdown markers", () => {
      const markerStringArb = fc.oneof(
        fc.string(),
        fc.constant("### Result\nnot json"),
        fc.constant("returned: broken payload"),
        fc.constant("```json\n{invalid\n```"),
        fc.string().map((s) => `returned: ${s}`),
        fc.string().map((s) => `### Result\n${s}`),
      );
      const payloadArb = fc.oneof(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 12 }), markerStringArb, {
          maxKeys: 5,
        }),
        fc.array(
          fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), markerStringArb, {
            maxKeys: 3,
          }),
          { minLength: 0, maxLength: 4 },
        ),
      );

      fc.assert(
        fc.property(payloadArb, (payload) => {
          const raw = JSON.stringify(payload);
          expect(parseLooseJson(raw)).toEqual(payload);
          expect(parseLooseJson(JSON.stringify(raw))).toEqual(payload);
        }),
        FC_OPTS,
      );
    });

    it("extracts balanced top-level arrays prefixed by non-JSON prose", () => {
      const arrArb = fc.array(
        fc.record({ id: fc.integer({ min: 0, max: 1000 }), ok: fc.boolean() }),
        { minLength: 1, maxLength: 5 },
      );
      const prefixArb = fc.constantFrom("Output: ", "Pages ", "Result:\n", "info: ");

      fc.assert(
        fc.property(prefixArb, arrArb, (prefix, arr) => {
          expect(parseLooseJson(`${prefix}${JSON.stringify(arr)}`)).toEqual(arr);
        }),
        FC_OPTS,
      );
    });

    it("never throws unhandled non-Error or hangs on arbitrary malformed MCP strings", () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 300 }), (text) => {
          try {
            parseLooseJson(text);
          } catch (error) {
            expect(error).toBeInstanceOf(Error);
          }
        }),
        FC_OPTS,
      );
    });

    it("extractMcpText and extractMcpImage tolerate arbitrary malformed content arrays", () => {
      const blockArb = fc.oneof(
        fc.record({ type: fc.constant("text" as const), text: fc.string() }),
        fc.record({
          type: fc.constant("image" as const),
          data: fc.string(),
          mimeType: fc.option(fc.string(), { nil: undefined }),
        }),
        fc.record({
          type: fc.constant("resource" as const),
          resource: fc.option(
            fc.record({
              text: fc.option(fc.string(), { nil: undefined }),
              uri: fc.option(fc.string(), { nil: undefined }),
            }),
            { nil: undefined },
          ),
        }),
        fc.constant(null as unknown),
        fc.constant(undefined as unknown),
        fc.dictionary(fc.string(), fc.anything(), { maxKeys: 3 }),
      );

      fc.assert(
        fc.property(
          fc.option(fc.array(blockArb, { maxLength: 10 }), { nil: undefined }),
          (content) => {
            const result = { content } as McpToolResult;
            const text = extractMcpText(result);
            expect(typeof text).toBe("string");
            const image = extractMcpImage(result);
            if (image !== null) {
              expect(typeof image.data).toBe("string");
            }
          },
        ),
        FC_OPTS,
      );
    });

    it("parseChromeDevtoolsListedPages strips trailing table pipes and emits sorted unique safe IDs", () => {
      const hostArb = fc.stringMatching(/^[a-z0-9-]{1,12}$/);
      const pathArb = fc.stringMatching(/^\/[a-z0-9/_-]{0,16}$/);
      const rowArb = fc.record({
        id: fc.integer({ min: 0, max: 100_000 }),
        host: hostArb,
        path: pathArb,
        tightPipe: fc.boolean(),
      });

      fc.assert(
        fc.property(fc.array(rowArb, { maxLength: 15 }), (rows) => {
          const table = rows
            .map((r) =>
              r.tightPipe
                ? `| ${r.id} | Title | https://${r.host}.test${r.path}|`
                : `| ${r.id} | Title | https://${r.host}.test${r.path} |`,
            )
            .join("\n");
          const parsed = parseChromeDevtoolsListedPages(table);
          for (let i = 0; i < parsed.length; i += 1) {
            expect(Number.isSafeInteger(parsed[i]!.toolPageId)).toBe(true);
            expect(parsed[i]!.url.endsWith("|")).toBe(false);
            if (i > 0) {
              expect(parsed[i]!.toolPageId).toBeGreaterThan(parsed[i - 1]!.toolPageId);
            }
          }
        }),
        FC_OPTS,
      );
    });

    it("parseChromeDevtoolsListedPages never produces non-safe or NaN page IDs on arbitrary input", () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 300 }), (text) => {
          const pages = parseChromeDevtoolsListedPages(text);
          for (let i = 0; i < pages.length; i += 1) {
            expect(Number.isSafeInteger(pages[i]!.toolPageId)).toBe(true);
            if (i > 0) {
              expect(pages[i]!.toolPageId).toBeGreaterThan(pages[i - 1]!.toolPageId);
            }
          }
        }),
        FC_OPTS,
      );
    });
  });

  describe("browserSessionLoss", () => {
    it("classifies prefix consistently and always redacts secrets from extracted causes", () => {
      const secretArb = fc.oneof(
        fc.stringMatching(/^sk-[A-Za-z0-9]{12,24}$/),
        fc.stringMatching(/^bb_live_[A-Za-z0-9]{10,20}$/),
        fc.stringMatching(/^AIza[A-Za-z0-9_-]{30,40}$/),
      );

      fc.assert(
        fc.property(fc.string(), secretArb, (noise, secret) => {
          expect(isBrowserSessionLostError(noise)).toBe(
            noise.startsWith(BROWSER_SESSION_LOST_ERROR_PREFIX),
          );
          const msg = `${BROWSER_SESSION_LOST_ERROR_PREFIX}lost while calling ${secret}). Stop.`;
          expect(isBrowserSessionLostError(msg)).toBe(true);
          const cause = browserSessionLostCause(msg);
          expect(cause).toBeDefined();
          expect(cause).not.toContain(secret);
        }),
        FC_OPTS,
      );
    });

    it("parseSessionLossTelemetry rejects malformed JSON/primitives and bounds numeric fields", () => {
      const payloadArb = fc.oneof(
        fc.string(),
        fc.constant(`${SESSION_LOST_TELEMETRY_PREFIX}null`),
        fc.constant(`${SESSION_LOST_TELEMETRY_PREFIX}[]`),
        fc.constant(`${SESSION_LOST_TELEMETRY_PREFIX}123`),
        fc
          .record({
            cause: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
            tool: fc.oneof(fc.string(), fc.integer(), fc.constant(undefined)),
            provider: fc.oneof(
              fc.constant("local"),
              fc.constant("browserbase"),
              fc.string(),
              fc.constant(undefined),
            ),
            sessionAgeMs: fc.oneof(
              fc.double({ noDefaultInfinity: false, noNaN: false }),
              fc.constant(undefined),
            ),
            sessionTimeoutMs: fc.oneof(
              fc.double({ noDefaultInfinity: false, noNaN: false }),
              fc.constant(undefined),
            ),
          })
          .map((obj) => `${SESSION_LOST_TELEMETRY_PREFIX}${JSON.stringify(obj)}`),
      );

      fc.assert(
        fc.property(payloadArb, (line) => {
          const parsed = parseSessionLossTelemetry(line);
          if (parsed !== undefined) {
            expect(typeof parsed.cause).toBe("string");
            if (parsed.provider !== undefined) {
              expect(["local", "browserbase"]).toContain(parsed.provider);
            }
            if (parsed.sessionAgeMs !== undefined) {
              expect(Number.isFinite(parsed.sessionAgeMs) && parsed.sessionAgeMs >= 0).toBe(true);
            }
            if (parsed.sessionTimeoutMs !== undefined) {
              expect(Number.isFinite(parsed.sessionTimeoutMs) && parsed.sessionTimeoutMs >= 0).toBe(
                true,
              );
            }
          }
        }),
        FC_OPTS,
      );
    });
  });

  describe("browserbaseSessionOptions and browseCliPaths", () => {
    it("accepts exactly integers in [60, 21600] (plus empty default) and rejects all others", () => {
      fc.assert(
        fc.property(fc.integer({ min: 60, max: 21_600 }), fc.nat({ max: 3 }), (n, pad) => {
          const raw = `${" ".repeat(pad)}${n}${" ".repeat(pad)}`;
          expect(evalBrowserbaseSessionTimeoutSeconds(raw)).toBe(n);
        }),
        FC_OPTS,
      );

      fc.assert(
        fc.property(
          fc.oneof(
            fc.integer({ min: -100_000, max: 59 }).map(String),
            fc.integer({ min: 21_601, max: 1_000_000 }).map(String),
            fc
              .double({ noNaN: false, noDefaultInfinity: false })
              .filter((x) => !Number.isInteger(x))
              .map(String),
            fc.string().filter((s) => !/^\s*(\d+)?\s*$/u.test(s)),
          ),
          (raw) => {
            expect(() => evalBrowserbaseSessionTimeoutSeconds(raw)).toThrow();
          },
        ),
        FC_OPTS,
      );

      fc.assert(
        fc.property(fc.stringMatching(/^[ \t\n\r]*$/), (blank) => {
          expect(evalBrowserbaseSessionTimeoutSeconds(blank)).toBe(
            DEFAULT_EVAL_BROWSERBASE_SESSION_TIMEOUT_SECONDS,
          );
        }),
        FC_OPTS,
      );
    });

    it("evalBooleanEnv and evalBrowserbaseSessionOptions agree on valid boolean tokens", () => {
      const trueToken = fc.constantFrom("1", "true", "yes", "on", "TRUE", " Yes ");
      const falseToken = fc.constantFrom("0", "false", "no", "off", "FALSE", " Off ");

      fc.assert(
        fc.property(trueToken, falseToken, fc.boolean(), (t, f, fallback) => {
          expect(evalBooleanEnv(t, fallback)).toBe(true);
          expect(evalBooleanEnv(f, fallback)).toBe(false);
          expect(evalBooleanEnv("   ", fallback)).toBe(fallback);
          expect(evalBooleanEnv(undefined, fallback)).toBe(fallback);
          const opts = evalBrowserbaseSessionOptions({
            EVAL_BROWSERBASE_SESSION_TIMEOUT_SECONDS: "120",
            EVAL_BROWSERBASE_PROXIES: f,
            EVAL_BROWSERBASE_VERIFIED: t,
          });
          expect(opts).toEqual({ timeoutSeconds: 120, proxies: false, verified: true });
        }),
        FC_OPTS,
      );
    });

    it("createBrowseCliSessionName always produces safe collision-resistant names", () => {
      const seen = new Set<string>();
      for (let i = 0; i < 64; i += 1) {
        const name = createBrowseCliSessionName();
        expect(name).toMatch(/^eval-\d+-[0-9a-f]{16}$/);
        expect(seen.has(name)).toBe(false);
        seen.add(name);
      }
    });
  });

  describe("metrics collector", () => {
    it("handles prototype keys safely and keeps summary stats ordered and finite", () => {
      const finiteArb = fc.double({
        min: -1e307,
        max: 1e307,
        noNaN: true,
        noDefaultInfinity: true,
      });

      fc.assert(
        fc.property(
          prototypeOrStringArb.filter((s) => s.length > 0),
          fc.array(finiteArb, { minLength: 1, maxLength: 40 }),
          (name, values) => {
            const collector = createMetricsCollector();
            for (const v of values) collector.record(name, v);
            const summary = collector.getSummary();
            expect(Object.hasOwn(summary, name)).toBe(true);
            const stats = summary[name]!;
            expect(stats.count).toBe(values.length);
            if (values.length >= 2) {
              expect(Number.isFinite(stats.min)).toBe(true);
              expect(Number.isFinite(stats.max)).toBe(true);
              expect(Number.isFinite(stats.avg)).toBe(true);
              expect(Number.isFinite(stats.p50)).toBe(true);
              expect(Number.isFinite(stats.p99)).toBe(true);
              expect(stats.min).toBeLessThanOrEqual(stats.p50);
              expect(stats.p50).toBeLessThanOrEqual(stats.p99);
              expect(stats.p99).toBeLessThanOrEqual(stats.max);
              expect(stats.avg).toBeGreaterThanOrEqual(
                stats.min - Math.abs(stats.min) * 1e-12 - 1e-12,
              );
              expect(stats.avg).toBeLessThanOrEqual(
                stats.max + Math.abs(stats.max) * 1e-12 + 1e-12,
              );
            }
          },
        ),
        FC_OPTS,
      );
    });

    it("ignores non-finite metric samples so summaries are never poisoned by NaN/Infinity", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.oneof(
              fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
              fc.constant(Number.NaN),
              fc.constant(Number.POSITIVE_INFINITY),
              fc.constant(Number.NEGATIVE_INFINITY),
            ),
            { minLength: 1, maxLength: 30 },
          ),
          (values) => {
            const collector = createMetricsCollector();
            for (const v of values) collector.record("latency", v);
            const summary = collector.getSummary();
            const finiteValues = values.filter((v) => Number.isFinite(v));
            if (finiteValues.length === 0) {
              expect(summary.latency).toBeUndefined();
            } else {
              expect(summary.latency!.count).toBe(finiteValues.length);
              for (const metricVal of Object.values(summary.latency!)) {
                expect(Number.isFinite(metricVal)).toBe(true);
              }
            }
          },
        ),
        FC_OPTS,
      );
    });
  });

  describe("runSummary aggregation", () => {
    const rowArb: fc.Arbitrary<SummaryRow> = fc
      .record({
        name: fc.string({ minLength: 1, maxLength: 20 }),
        modelName: fc.constantFrom(
          "openai/gpt-5.4-mini",
          "anthropic/claude-sonnet-4-6",
          "google/gemini-3-flash",
        ),
        toolSurface: fc.option(fc.constantFrom("stagehand_facade", "playwright_mcp"), {
          nil: undefined,
        }),
        success: fc.boolean(),
        harnessStatus: fc.option(fc.constantFrom("completed", "max_turns", "sdk_error"), {
          nil: undefined,
        }),
        criterionCount: fc.oneof(
          fc.constant(undefined),
          fc.integer({ min: 0, max: 20 }),
          fc.constant(Number.NaN),
          fc.constant(Number.POSITIVE_INFINITY),
          fc.constant(-5),
        ),
        verifierError: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
        judgeOutcomeSuccess: fc.option(fc.boolean(), { nil: undefined }),
        outcomeGates: fc.option(
          fc.array(
            prototypeOrStringArb.filter((s) => s.length > 0),
            { maxLength: 3 },
          ),
          { nil: undefined },
        ),
        totalTokens: fc.oneof(
          fc.constant(undefined),
          fc.double({ min: -100, max: 1e7, noNaN: false, noDefaultInfinity: false }),
        ),
        costUsd: fc.oneof(
          fc.constant(undefined),
          fc.double({ min: -10, max: 1000, noNaN: false, noDefaultInfinity: false }),
        ),
      })
      .map((r) => ({
        name: r.name,
        input: {
          name: r.name,
          modelName: r.modelName,
          ...(r.toolSurface ? { params: { toolSurface: r.toolSurface } } : {}),
        } as SummaryRow["input"],
        output: {
          _success: r.success,
          ...(r.harnessStatus !== undefined && { harnessStatus: r.harnessStatus }),
          ...(r.criterionCount !== undefined && { criterionCount: r.criterionCount }),
          ...(r.verifierError !== undefined && { verifierError: r.verifierError }),
          ...(r.judgeOutcomeSuccess !== undefined && {
            judgeOutcomeSuccess: r.judgeOutcomeSuccess,
          }),
          ...(r.outcomeGates !== undefined && { outcomeGates: r.outcomeGates }),
          metrics: {
            ...(r.totalTokens !== undefined && {
              harness_total_tokens: { count: 1, value: r.totalTokens },
            }),
            ...(r.costUsd !== undefined && {
              harness_cost_usd: { count: 1, value: r.costUsd },
            }),
          },
        },
      }));

    it("maintains exact conservation, bounded passRate, finite counts, and prototype-safe gates", () => {
      fc.assert(
        fc.property(fc.array(rowArb, { maxLength: 25 }), (rows) => {
          const json = buildRunSummaryJson({
            results: rows,
            harness: "codex",
            experimentName: "prop-exp",
          });

          expect(json.summary.total).toBe(rows.length);
          expect(json.summary.passed + json.summary.failed).toBe(json.summary.total);
          expect(json.summary.passRate).toBeGreaterThanOrEqual(0);
          expect(json.summary.passRate).toBeLessThanOrEqual(100);
          expect(Number.isInteger(json.summary.passRate)).toBe(true);
          expect(json.failures.length).toBe(json.summary.failed);

          const cellTotal = json.cells.reduce((acc, c) => acc + c.total, 0);
          const cellPassed = json.cells.reduce((acc, c) => acc + c.passed, 0);
          expect(cellTotal).toBe(json.summary.total);
          expect(cellPassed).toBe(json.summary.passed);

          expect(json.verifier.attempted).toBe(json.verifier.graded + json.verifier.ungraded);
          expect(Number.isFinite(json.verifier.totalCriteria)).toBe(true);
          expect(json.verifier.totalCriteria).toBeGreaterThanOrEqual(0);
          expect(json.deadJudge).toBe(isDeadJudgeRun(json.verifier));

          expect(Number.isFinite(json.usage.totalTokens)).toBe(true);
          expect(json.usage.totalTokens).toBeGreaterThanOrEqual(0);
          if (json.usage.costUsd !== undefined) {
            expect(Number.isFinite(json.usage.costUsd)).toBe(true);
            expect(json.usage.costUsd).toBeGreaterThanOrEqual(0);
          }

          for (const count of Object.values(json.gates)) {
            expect(typeof count).toBe("number");
            expect(Number.isInteger(count) && count > 0).toBe(true);
          }

          for (const r of rows) {
            const outcome = classifyRowOutcome(r.output);
            expect(outcome === "pass").toBe(r.output._success === true);
          }

          expect(summarizeCells(rows, "codex")).toEqual(json.cells);
          expect(summarizeGates(rows)).toEqual(json.gates);
          expect(summarizeUsage(rows)).toEqual(json.usage);
          expect(summarizeVerifier(rows)).toEqual(json.verifier);
        }),
        FC_OPTS,
      );
    });
  });

  describe("usageNormalization and costEstimate", () => {
    const tokenValArb = fc.oneof(
      fc.constant(undefined),
      fc.integer({ min: -50, max: 5_000_000 }),
      fc.constant(Number.NaN),
      fc.constant(Number.POSITIVE_INFINITY),
      fc.constant(Number.NEGATIVE_INFINITY),
      fc.constant(Number.MAX_VALUE),
    );

    const harnessArb = fc.oneof(
      fc.constantFrom(
        "claude_code",
        "codex",
        "mastra",
        "eve",
        "deepagents",
        "fx",
        "pi",
        "cursor",
        "cursor_sdk",
        "claude_cua",
        "gemini_cua",
      ),
      prototypeOrStringArb,
    );

    it("preserves non-negativity, finiteness, and exact input bucket conservation", () => {
      fc.assert(
        fc.property(
          harnessArb,
          tokenValArb,
          tokenValArb,
          tokenValArb,
          tokenValArb,
          tokenValArb,
          fc.option(fc.boolean(), { nil: undefined }),
          (
            harness,
            inputTokens,
            cachedInputTokens,
            cacheCreationInputTokens,
            outputTokens,
            reasoningOutputTokens,
            reported,
          ) => {
            const conv = usageConventionFor(harness);
            expect([
              "openai_cached_subset",
              "anthropic_cache_separate",
              "uncached_only",
              "unreported",
            ]).toContain(conv);

            const normalized = normalizeUsage({
              harness,
              raw: {
                inputTokens: inputTokens ?? 0,
                outputTokens: outputTokens ?? 0,
                totalTokens: 0,
                ...(cachedInputTokens !== undefined && { cachedInputTokens }),
                ...(cacheCreationInputTokens !== undefined && { cacheCreationInputTokens }),
                ...(reasoningOutputTokens !== undefined && { reasoningOutputTokens }),
                ...(reported !== undefined && { reported }),
              },
            });

            for (const bucket of [
              normalized.input_total,
              normalized.input_cached,
              normalized.input_cache_write,
              normalized.input_uncached,
              normalized.output,
              normalized.reasoning,
            ]) {
              expect(Number.isFinite(bucket)).toBe(true);
              expect(bucket).toBeGreaterThanOrEqual(0);
            }

            if (normalized.convention === "openai_cached_subset") {
              expect(
                normalized.input_uncached + normalized.input_cached + normalized.input_cache_write,
              ).toBe(normalized.input_total);
            }
            if (reported === false) {
              expect(normalized.convention).toBe("unreported");
            }
            expect(typeof formatNormalizedUsage(normalized)).toBe("string");
          },
        ),
        FC_OPTS,
      );
    });

    it("handles prototype keys in model/provider/harness names without throwing or returning functions", () => {
      const priceMap: PriceMap = {
        as_of: "2026-08-31",
        models: {
          "openai/gpt-5.4-mini": {
            input_per_m: 1,
            cached_input_per_m: 0.1,
            output_per_m: 4,
            source: "test",
          },
        },
      };

      const modelArb = fc.oneof(
        prototypeOrStringArb,
        fc.tuple(prototypeOrStringArb, prototypeOrStringArb).map(([p, m]) => `${p}/${m}`),
        fc.constant("openai/gpt-5.4-mini"),
      );

      fc.assert(
        fc.property(
          harnessArb,
          modelArb,
          fc.option(fc.double({ noNaN: false, noDefaultInfinity: false }), { nil: undefined }),
          (harness, model, reportedCostUsd) => {
            const candidates = modelPriceCandidates(model);
            expect(Array.isArray(candidates)).toBe(true);
            for (const c of candidates) expect(typeof c).toBe("string");

            const provider = providerOf(model);
            expect(provider === undefined || typeof provider === "string").toBe(true);

            const resolved = resolveModelPrice(model, priceMap);
            expect(resolved === undefined || typeof resolved.key === "string").toBe(true);

            const usage = normalizeUsage({
              harness,
              raw: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, reported: true },
            });
            const cost = computeListCost(usage, model, priceMap);
            if (cost !== undefined) {
              expect(Number.isFinite(cost) && cost >= 0).toBe(true);
            }

            const billed = resolveBilledCost({
              harness,
              model,
              usage,
              reportedCostUsd,
              priceMap,
            });
            expect(typeof billed.billing_channel).toBe("string");
            if (billed.cost_usd !== undefined) {
              expect(Number.isFinite(billed.cost_usd) && billed.cost_usd >= 0).toBe(true);
            }
          },
        ),
        FC_OPTS,
      );
    });
  });
});
