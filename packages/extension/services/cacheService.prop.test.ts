import { trace } from "@opentelemetry/api";
import fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import type {
  Action,
  CacheMetadata,
  LLMGenerateResult,
  Variables,
  VariableValue,
} from "@browserbasehq/stagehand-protocol/types";
import type {
  CacheClient,
  CacheGetRequest,
  CacheGetResponse,
  CacheSetRequest,
} from "../clients/cacheClient.js";
import {
  performUnderstudyMethod,
  waitForDomNetworkQuiet,
} from "../handlers/handlerUtils/actHandlerUtils.js";
import { StagehandLogger } from "../logger.js";
import type { Frame } from "../understudy/frame.js";
import type { Page } from "../understudy/page.js";
import * as actService from "./actService.js";
import * as cacheService from "./cacheService.js";
import * as observeService from "./observeService.js";

vi.mock("../handlers/handlerUtils/actHandlerUtils.js", () => ({
  performUnderstudyMethod: vi.fn(),
  waitForDomNetworkQuiet: vi.fn(),
}));

const performAction = vi.mocked(performUnderstudyMethod);
const waitForQuiet = vi.mocked(waitForDomNetworkQuiet);

const BASE_SEED = 20261124;

function testLogger(): StagehandLogger {
  return new StagehandLogger({ tracer: trace.getTracer("cache-prop-test") }, () => {});
}

function makeActGeneration(
  action: Record<string, string | string[]> | null,
  twoStep = false,
): LLMGenerateResult {
  return {
    role: "assistant",
    content: { type: "text", text: "structured action" },
    outputFormat: "json_schema",
    structuredContent: z.json().parse({ action, twoStep }),
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      reasoningTokens: 0,
      cachedInputTokens: 0,
    },
  };
}

function makeObserveGeneration(
  elements: Array<{ elementId: string; description: string; method: string; arguments: string[] }>,
): LLMGenerateResult {
  return {
    role: "assistant",
    content: { type: "text", text: "structured observation" },
    outputFormat: "json_schema",
    structuredContent: z.json().parse({ elements }),
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      reasoningTokens: 0,
      cachedInputTokens: 0,
    },
  };
}

function makeMockPage(
  url = "https://example.com/app",
  xpath = "/html/body/input",
): {
  page: Page;
  frame: Frame;
  captureSnapshot: ReturnType<typeof vi.fn>;
} {
  const frame = {
    frameId: "frame-main",
    getAccessibilityTree: vi.fn(async () => []),
  } as unknown as Frame;
  const captureSnapshot = vi.fn(async () => ({
    combinedTree: "[0-1] textbox: Target",
    combinedXpathMap: { "0-1": xpath },
    combinedUrlMap: {},
  }));
  const page = {
    url: () => url,
    frames: () => [frame],
    mainFrame: () => frame,
    captureSnapshot,
  } as unknown as Page;
  return { page, frame, captureSnapshot };
}

const variableNameArb = fc.oneof(
  fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_.-]{0,12}$/),
  fc.constantFrom(
    "pass",
    "password",
    "pass_word",
    "a.b",
    "a+b",
    "foo[0]",
    "(x)",
    "$var",
    "a\\b",
    "a%b",
    "toString",
    "constructor",
    "valueOf",
  ),
);

const adversarialSecretFragmentArb = fc.oneof(
  fc.constant("$&"),
  fc.constant("$$"),
  fc.constant("$'"),
  fc.constant("$`"),
  fc.constant("$1"),
  fc.constant('\\"\\n{}[]'),
  fc.constant("p@ss/w?rd=1&2"),
  fc.string({ minLength: 1, maxLength: 12 }),
);

const validActionArb: fc.Arbitrary<Action> = fc.record({
  selector: fc
    .stringMatching(/^\/html\/body\/[a-z]{1,8}\[\d{1,2}\]$/)
    .map((xpath) => `xpath=${xpath}`),
  description: fc.string({ minLength: 1, maxLength: 24 }),
  method: fc.constantFrom("click", "fill", "type", "hover", "press"),
  arguments: fc.array(fc.string({ maxLength: 16 }), { maxLength: 2 }),
});

describe("cacheService and actService adversarial properties", () => {
  beforeEach(() => {
    performAction.mockReset().mockResolvedValue();
    waitForQuiet.mockReset().mockResolvedValue();
  });

  describe("post-commit fallback safety", () => {
    it("never falls back to LLM inference or poisons cache after committing at least one cached step", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(validActionArb, { minLength: 2, maxLength: 5 }),
          fc.integer({ min: 1, max: 4 }),
          fc.string({ minLength: 1, maxLength: 32 }),
          async (cachedActions, rawFailOffset, errorMsg) => {
            performAction.mockReset();
            const failIdx = Math.min(rawFailOffset, cachedActions.length - 1);
            let callCount = 0;
            performAction.mockImplementation(async () => {
              const current = callCount;
              callCount += 1;
              if (current === failIdx) {
                throw new Error(errorMsg);
              }
            });

            const { page } = makeMockPage();
            const get = vi.fn().mockResolvedValue({
              hit: true,
              cacheKey: "multi-step-key",
              value: cachedActions,
              hitCount: 3,
              threshold: 2,
            } satisfies CacheGetResponse);
            const set = vi.fn().mockResolvedValue({ written: true, cacheKey: "multi-step-key" });
            const clientLLMGenerate = vi.fn(async () =>
              makeActGeneration({
                elementId: "0-1",
                description: "Fallback action",
                method: "click",
                arguments: [],
              }),
            );

            const result = await actService.act({
              params: { pageId: "page-1", instruction: "Perform multi-step checkout" },
              page,
              model: { source: "client" },
              clientLLMGenerate,
              logger: testLogger(),
              cache: {
                sessionId: "session-1",
                client: { get, set } as unknown as CacheClient,
                defaultCaching: true,
              },
            });

            expect(performAction).toHaveBeenCalledTimes(failIdx + 1);
            expect(clientLLMGenerate).not.toHaveBeenCalled();
            expect(set).not.toHaveBeenCalled();
            expect(result.data.success).toBe(false);
            expect(result.data.actions).toHaveLength(failIdx);
            expect(result.metadata.cache).toStrictEqual({
              status: "MISS",
              missReason: "replay_failed",
              count: 3,
              threshold: 2,
            });
          },
        ),
        { seed: BASE_SEED, numRuns: 60 },
      );
    });

    it("falls back safely to LLM inference when step 0 fails before any DOM mutation", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(validActionArb, { minLength: 1, maxLength: 4 }),
          fc.string({ minLength: 1, maxLength: 24 }),
          async (cachedActions, errorMsg) => {
            performAction.mockReset();
            performAction.mockRejectedValueOnce(new Error(errorMsg)).mockResolvedValueOnce();

            const { page } = makeMockPage();
            const get = vi.fn().mockResolvedValue({
              hit: true,
              cacheKey: "stale-key",
              value: cachedActions,
              hitCount: 2,
            } satisfies CacheGetResponse);
            const set = vi.fn().mockResolvedValue({ written: true, cacheKey: "stale-key" });
            const clientLLMGenerate = vi.fn(async () =>
              makeActGeneration({
                elementId: "0-1",
                description: "Fresh action",
                method: "click",
                arguments: [],
              }),
            );

            const result = await actService.act({
              params: { pageId: "page-1", instruction: "Click submit" },
              page,
              model: { source: "client" },
              clientLLMGenerate,
              logger: testLogger(),
              cache: {
                sessionId: "session-1",
                client: { get, set } as unknown as CacheClient,
                defaultCaching: true,
              },
            });

            expect(performAction).toHaveBeenCalledTimes(2);
            expect(clientLLMGenerate).toHaveBeenCalledTimes(1);
            expect(set).toHaveBeenCalledTimes(1);
            expect(result.data.success).toBe(true);
            expect(result.metadata.cache).toStrictEqual({
              status: "MISS",
              missReason: "replay_failed",
              count: 2,
            });
          },
        ),
        { seed: BASE_SEED + 1, numRuns: 40 },
      );
    });

    it("rejects malformed multi-step cached actions pre-commit without executing earlier steps", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(validActionArb, { minLength: 1, maxLength: 3 }),
          fc.constantFrom(undefined, "", "   ", "not-supported"),
          async (validPrefix, badMethod) => {
            performAction.mockReset().mockResolvedValue();
            const badStep: Action = {
              selector: "xpath=/html/body/div[1]",
              description: "Corrupt step",
              method: badMethod,
              arguments: [],
            };
            const cachedActions = [...validPrefix, badStep];

            const { page } = makeMockPage();
            const get = vi.fn().mockResolvedValue({
              hit: true,
              cacheKey: "bad-multi-key",
              value: cachedActions,
            } satisfies CacheGetResponse);
            const set = vi.fn().mockResolvedValue({ written: true, cacheKey: "bad-multi-key" });
            const clientLLMGenerate = vi.fn(async () =>
              makeActGeneration({
                elementId: "0-1",
                description: "Recovered action",
                method: "click",
                arguments: [],
              }),
            );

            const result = await actService.act({
              params: { pageId: "page-1", instruction: "Recover cleanly" },
              page,
              model: { source: "client" },
              clientLLMGenerate,
              logger: testLogger(),
              cache: {
                sessionId: "session-1",
                client: { get, set } as unknown as CacheClient,
                defaultCaching: true,
              },
            });

            expect(performAction).toHaveBeenCalledTimes(1);
            expect(clientLLMGenerate).toHaveBeenCalledTimes(1);
            expect(result.data.success).toBe(true);
            expect(result.metadata.cache).toStrictEqual({
              status: "MISS",
              missReason: "replay_failed",
            });
          },
        ),
        { seed: BASE_SEED + 2, numRuns: 30 },
      );
    });
    it("rethrows CacheReplayCommittedError without fallback when no committedResult is attached", async () => {
      await fc.assert(
        fc.asyncProperty(fc.string({ minLength: 1, maxLength: 32 }), async (errorMsg) => {
          const { page } = makeMockPage();
          const get = vi.fn().mockResolvedValue({
            hit: true,
            cacheKey: "committed-key",
            value: { answer: 1 },
          } satisfies CacheGetResponse);
          const set = vi.fn();
          const execute = vi.fn();

          await expect(
            cacheService.withCache({
              method: "act",
              page,
              data: { input: "Click" },
              context: {
                sessionId: "session-1",
                client: { get, set } as unknown as CacheClient,
                defaultCaching: true,
              },
              logger: testLogger(),
              onHit: () => {
                throw new cacheService.CacheReplayCommittedError(errorMsg);
              },
              execute,
            }),
          ).rejects.toThrow(cacheService.CacheReplayCommittedError);

          expect(execute).not.toHaveBeenCalled();
          expect(set).not.toHaveBeenCalled();
        }),
        { seed: BASE_SEED + 3, numRuns: 30 },
      );
    });
  });

  describe("secret variable non-leakage and single-pass substitution", () => {
    it("never leaks secret variable values into cache payloads, wire requests, or persisted actions", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uniqueArray(variableNameArb, { minLength: 1, maxLength: 5 }),
          fc.array(adversarialSecretFragmentArb, { minLength: 5, maxLength: 5 }),
          fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
          fc.string({ minLength: 1, maxLength: 32 }),
          async (names, fragments, useObjectForm, instruction) => {
            performAction.mockReset().mockResolvedValue();
            const variables: Variables = {};
            const canaries: string[] = [];

            names.forEach((name, idx) => {
              const canary = `SECRET_CANARY_${idx}_${fragments[idx]}`;
              canaries.push(canary);
              const val: VariableValue = useObjectForm[idx]
                ? { value: canary, description: `Field description ${idx}` }
                : canary;
              variables[name] = val;
            });

            const actCacheData = cacheService.buildActCacheData({
              pageId: "page-1",
              instruction,
              options: { variables },
            });
            const observeCacheData = cacheService.buildObserveCacheData({
              pageId: "page-1",
              instruction,
              options: { variables },
            });

            const actDataJson = JSON.stringify(actCacheData);
            const observeDataJson = JSON.stringify(observeCacheData);
            for (const canary of canaries) {
              expect(actDataJson).not.toContain(canary);
              expect(observeDataJson).not.toContain(canary);
            }

            const capturedGets: CacheGetRequest[] = [];
            const capturedSets: CacheSetRequest[] = [];
            const get = vi.fn(async (req: CacheGetRequest) => {
              capturedGets.push(req);
              return { hit: false, cacheKey: "k", missReason: "not_found" };
            });
            const set = vi.fn(async (req: CacheSetRequest) => {
              capturedSets.push(req);
              return { written: true, cacheKey: "k" };
            });

            const { page } = makeMockPage();
            const targetKey = names[0]!;
            const actResult = await actService.act({
              params: {
                pageId: "page-1",
                instruction,
                options: { variables },
              },
              page,
              model: { source: "client" },
              clientLLMGenerate: vi.fn(async () =>
                makeActGeneration({
                  elementId: "0-1",
                  description: "Secret input",
                  method: "fill",
                  arguments: [`%${targetKey}%`],
                }),
              ),
              logger: testLogger(),
              cache: {
                sessionId: "session-1",
                client: { get, set } as unknown as CacheClient,
                defaultCaching: true,
              },
            });

            const obsResult = await observeService.observe({
              params: {
                pageId: "page-1",
                instruction,
                options: { variables },
              },
              page,
              model: { source: "client" },
              clientLLMGenerate: vi.fn(async () =>
                makeObserveGeneration([
                  {
                    elementId: "0-1",
                    description: "Secret input",
                    method: "fill",
                    arguments: [`%${targetKey}%`],
                  },
                ]),
              ),
              logger: testLogger(),
              cache: {
                sessionId: "session-1",
                client: { get, set } as unknown as CacheClient,
                defaultCaching: true,
              },
            });

            const serializedArtifacts = [
              JSON.stringify(capturedGets),
              JSON.stringify(capturedSets),
              JSON.stringify(actResult),
              JSON.stringify(obsResult),
            ];
            for (const artifact of serializedArtifacts) {
              for (const canary of canaries) {
                expect(artifact).not.toContain(canary);
              }
            }
          },
        ),
        { seed: BASE_SEED + 10, numRuns: 50 },
      );
    });

    it("produces identical cache data when only secret values or key insertion order change", () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(variableNameArb, { minLength: 1, maxLength: 6 }),
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 6, maxLength: 6 }),
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 6, maxLength: 6 }),
          fc.string({ minLength: 1, maxLength: 24 }),
          (names, secretsA, secretsB, instruction) => {
            const varsA: Variables = {};
            const varsB: Variables = {};
            names.forEach((name, idx) => {
              varsA[name] = secretsA[idx]!;
            });
            [...names].reverse().forEach((name) => {
              const idx = names.indexOf(name);
              varsB[name] = secretsB[idx]!;
            });

            const actA = cacheService.buildActCacheData({
              pageId: "page-1",
              instruction,
              options: { variables: varsA },
            });
            const actB = cacheService.buildActCacheData({
              pageId: "page-1",
              instruction,
              options: { variables: varsB },
            });
            expect(actA).toStrictEqual(actB);
            expect(JSON.stringify(actA)).toBe(JSON.stringify(actB));

            const obsA = cacheService.buildObserveCacheData({
              pageId: "page-1",
              instruction,
              options: { variables: varsA },
            });
            const obsB = cacheService.buildObserveCacheData({
              pageId: "page-1",
              instruction,
              options: { variables: varsB },
            });
            expect(obsA).toStrictEqual(obsB);
            expect(JSON.stringify(obsA)).toBe(JSON.stringify(obsB));
          },
        ),
        { seed: BASE_SEED + 11, numRuns: 100 },
      );
    });

    it("performs single-pass variable substitution without $&/$$ corruption or cross-variable expansion", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uniqueArray(variableNameArb, { minLength: 2, maxLength: 5 }),
          fc.array(adversarialSecretFragmentArb, { minLength: 5, maxLength: 5 }),
          fc.string({ maxLength: 10 }),
          fc.string({ maxLength: 10 }),
          async (names, fragments, prefix, suffix) => {
            performAction.mockReset().mockResolvedValue();
            const keyA = names[0]!;
            const keyB = names[1]!;

            const valA = `${fragments[0]}%${keyB}%${fragments[1]}`;
            const valB = `SENSITIVE_${fragments[2]}_$&_$$_$1`;

            const varsForward: Variables = { [keyA]: valA, [keyB]: valB };
            const varsReverse: Variables = { [keyB]: valB, [keyA]: valA };

            const cleanPrefix = prefix.replaceAll("%", "_");
            const cleanSuffix = suffix.replaceAll("%", "_");
            const template = `${cleanPrefix}%${keyA}%:%${keyB}%:%unknownKey%:%toString%${cleanSuffix}`;

            const runWith = async (variables: Variables) => {
              performAction.mockReset().mockResolvedValue();
              const { page } = makeMockPage();
              await actService.act({
                params: {
                  pageId: "page-1",
                  instruction: {
                    selector: "xpath=/html/body/input",
                    description: "Input field",
                    method: "fill",
                    arguments: [template],
                  },
                  options: { variables },
                },
                page,
                model: { source: "client" },
                clientLLMGenerate: vi.fn(),
                logger: testLogger(),
              });
              return performAction.mock.calls[0]?.[4];
            };

            const forwardResolved = await runWith(varsForward);
            const reverseResolved = await runWith(varsReverse);

            const toStringReplacement =
              keyA === "toString" ? valA : keyB === "toString" ? valB : "%toString%";
            const expectedResolved = `${cleanPrefix}${valA}:${valB}:%unknownKey%:${toStringReplacement}${cleanSuffix}`;

            expect(forwardResolved).toStrictEqual([expectedResolved]);
            expect(reverseResolved).toStrictEqual(forwardResolved);
          },
        ),
        { seed: BASE_SEED + 12, numRuns: 80 },
      );
    });
  });

  describe("cache key determinism, isolation, and corrupt payload resilience", () => {
    it("isolates distinct instructions, variable names, descriptions, and thresholds without mutating caller data", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 30 }),
          fc.string({ minLength: 1, maxLength: 30 }),
          variableNameArb,
          variableNameArb,
          (inst1, inst2, key1, key2) => {
            if (inst1 !== inst2) {
              expect(
                cacheService.buildActCacheData({ pageId: "p", instruction: inst1 }),
              ).not.toStrictEqual(
                cacheService.buildActCacheData({ pageId: "p", instruction: inst2 }),
              );
              expect(
                cacheService.buildObserveCacheData({ pageId: "p", instruction: inst1 }),
              ).not.toStrictEqual(
                cacheService.buildObserveCacheData({ pageId: "p", instruction: inst2 }),
              );
            }

            if (key1 !== key2) {
              expect(
                cacheService.buildActCacheData({
                  pageId: "p",
                  instruction: inst1,
                  options: { variables: { [key1]: "v" } },
                }),
              ).not.toStrictEqual(
                cacheService.buildActCacheData({
                  pageId: "p",
                  instruction: inst1,
                  options: { variables: { [key2]: "v" } },
                }),
              );
            }

            expect(
              cacheService.buildObserveCacheData({
                pageId: "p",
                instruction: inst1,
                options: { variables: { [key1]: { value: "v", description: "Desc A" } } },
              }),
            ).not.toStrictEqual(
              cacheService.buildObserveCacheData({
                pageId: "p",
                instruction: inst1,
                options: { variables: { [key1]: { value: "v", description: "Desc B" } } },
              }),
            );
          },
        ),
        { seed: BASE_SEED + 20, numRuns: 100 },
      );
    });

    it("never crashes when normalizing arbitrary corrupt or cjson-mangled cached action payloads", () => {
      fc.assert(
        fc.property(fc.anything(), (corruptPayload) => {
          const normalized = cacheService.normalizeCachedActions(corruptPayload);
          expect(Array.isArray(normalized)).toBe(true);
          for (const action of normalized) {
            expect(typeof action.selector).toBe("string");
            expect(action.selector.length).toBeGreaterThan(0);
            expect(typeof action.description).toBe("string");
            expect(action.method === undefined || typeof action.method === "string").toBe(true);
            expect(Array.isArray(action.arguments)).toBe(true);
            for (const arg of action.arguments ?? []) {
              expect(typeof arg).toBe("string");
            }
          }
        }),
        { seed: BASE_SEED + 21, numRuns: 200 },
      );
    });

    it("recovers gracefully from arbitrary corrupt cache values without crashing act()", async () => {
      const corruptValueArb = fc.oneof(
        fc.constant(null),
        fc.constant(undefined),
        fc.constant({}),
        fc.constant([]),
        fc.string(),
        fc.integer(),
        fc.boolean(),
        fc.array(
          fc.oneof(
            fc.constant(null),
            fc.constant({}),
            fc.constant({ selector: "" }),
            fc.constant({ selector: 123, method: "click" }),
            fc.constant({ selector: "xpath=//a", method: "not-supported" }),
          ),
          { maxLength: 4 },
        ),
      );

      await fc.assert(
        fc.asyncProperty(corruptValueArb, async (corruptValue) => {
          performAction.mockReset().mockResolvedValue();
          const { page } = makeMockPage();
          const get = vi.fn().mockResolvedValue({
            hit: true,
            cacheKey: "corrupt-key",
            value: corruptValue,
          } satisfies CacheGetResponse);
          const set = vi.fn().mockResolvedValue({ written: true, cacheKey: "corrupt-key" });
          const clientLLMGenerate = vi.fn(async () =>
            makeActGeneration({
              elementId: "0-1",
              description: "Recovered",
              method: "click",
              arguments: [],
            }),
          );

          const result = await actService.act({
            params: { pageId: "page-1", instruction: "Click button" },
            page,
            model: { source: "client" },
            clientLLMGenerate,
            logger: testLogger(),
            cache: {
              sessionId: "session-1",
              client: { get, set } as unknown as CacheClient,
              defaultCaching: true,
            },
          });

          expect(result.data.success).toBe(true);
          expect(result.metadata.cache.status).toBe("MISS");
          expect(clientLLMGenerate).toHaveBeenCalledTimes(1);
          expect(set).toHaveBeenCalledTimes(1);
        }),
        { seed: BASE_SEED + 22, numRuns: 50 },
      );
    });
  });

  describe("stateful cache recovery and failure non-poisoning", () => {
    type CacheOp =
      | { kind: "read_hit"; key: string }
      | { kind: "miss_success"; key: string; value: string }
      | { kind: "miss_execute_throws"; key: string }
      | { kind: "miss_no_cache_value"; key: string }
      | { kind: "read_error_then_success"; key: string; value: string }
      | { kind: "read_payload_too_large"; key: string; value: string }
      | { kind: "write_error_on_miss"; key: string; value: string }
      | { kind: "bypass"; key: string; value: string };

    const keyArb = fc.constantFrom("k1", "k2", "k3");
    const opArb: fc.Arbitrary<CacheOp> = fc.oneof(
      fc.record({ kind: fc.constant("read_hit" as const), key: keyArb }),
      fc.record({
        kind: fc.constant("miss_success" as const),
        key: keyArb,
        value: fc.string({ minLength: 1, maxLength: 12 }),
      }),
      fc.record({ kind: fc.constant("miss_execute_throws" as const), key: keyArb }),
      fc.record({ kind: fc.constant("miss_no_cache_value" as const), key: keyArb }),
      fc.record({
        kind: fc.constant("read_error_then_success" as const),
        key: keyArb,
        value: fc.string({ minLength: 1, maxLength: 12 }),
      }),
      fc.record({
        kind: fc.constant("read_payload_too_large" as const),
        key: keyArb,
        value: fc.string({ minLength: 1, maxLength: 12 }),
      }),
      fc.record({
        kind: fc.constant("write_error_on_miss" as const),
        key: keyArb,
        value: fc.string({ minLength: 1, maxLength: 12 }),
      }),
      fc.record({
        kind: fc.constant("bypass" as const),
        key: keyArb,
        value: fc.string({ minLength: 1, maxLength: 12 }),
      }),
    );

    it("preserves cache integrity and metadata invariants across arbitrary operation sequences", async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 20 }), async (ops) => {
          const store = new Map<string, string>();
          const { page } = makeMockPage();

          type BoxResult = { data: string; metadata: { cache: CacheMetadata } };
          const makeBox = (data: string): BoxResult => ({
            data,
            metadata: { cache: { status: "DISABLED" } },
          });

          for (const op of ops) {
            const snapshotBefore = new Map(store);
            const setSpy = vi.fn(async (req: CacheSetRequest) => {
              if (op.kind === "write_error_on_miss") {
                throw new Error("write boom");
              }
              store.set(String(req.data.instruction), String(req.value));
              return { written: true, cacheKey: String(req.data.instruction) };
            });

            const getSpy = vi.fn(async (req: CacheGetRequest): Promise<CacheGetResponse> => {
              const k = String(req.data.instruction);
              if (op.kind === "read_error_then_success") {
                throw new Error("network down");
              }
              if (op.kind === "read_payload_too_large") {
                return { cacheKey: null, hit: false, missReason: "payload_too_large" };
              }
              if (op.kind === "read_hit" && store.has(k)) {
                return {
                  cacheKey: k,
                  hit: true,
                  value: store.get(k),
                  hitCount: 2,
                  threshold: 1,
                  tokensSaved: { input: 10, output: 5, total: 15 },
                };
              }
              return { cacheKey: k, hit: false, missReason: "not_found" };
            });

            const context: cacheService.CacheContext = {
              sessionId: "s1",
              client: { get: getSpy, set: setSpy } as unknown as CacheClient,
              defaultCaching: true,
            };

            switch (op.kind) {
              case "read_hit": {
                const res = await cacheService.withCache<BoxResult>({
                  method: "extract",
                  page,
                  data: { instruction: op.key },
                  context,
                  logger: testLogger(),
                  onHit: (v) => makeBox(String(v)),
                  execute: async () => ({ result: makeBox("fallback"), cacheValue: undefined }),
                });
                if (snapshotBefore.has(op.key)) {
                  expect(res.data).toBe(snapshotBefore.get(op.key));
                  expect(res.metadata.cache.status).toBe("HIT");
                  expect(res.metadata.cache.missReason).toBeUndefined();
                  expect(setSpy).not.toHaveBeenCalled();
                } else {
                  expect(res.metadata.cache.status).toBe("MISS");
                  expect(res.metadata.cache.tokensSaved).toBeUndefined();
                }
                break;
              }
              case "miss_success": {
                const res = await cacheService.withCache<BoxResult>({
                  method: "extract",
                  page,
                  data: { instruction: op.key },
                  context,
                  logger: testLogger(),
                  onHit: (v) => makeBox(String(v)),
                  execute: async () => ({ result: makeBox(op.value), cacheValue: op.value }),
                });
                expect(res.data).toBe(op.value);
                expect(res.metadata.cache.status).toBe("MISS");
                expect(res.metadata.cache.tokensSaved).toBeUndefined();
                expect(store.get(op.key)).toBe(op.value);
                break;
              }
              case "miss_execute_throws": {
                await expect(
                  cacheService.withCache<BoxResult>({
                    method: "extract",
                    page,
                    data: { instruction: op.key },
                    context,
                    logger: testLogger(),
                    onHit: (v) => makeBox(String(v)),
                    execute: async () => {
                      throw new Error("live failure");
                    },
                  }),
                ).rejects.toThrow("live failure");
                expect(setSpy).not.toHaveBeenCalled();
                expect(store).toStrictEqual(snapshotBefore);
                break;
              }
              case "miss_no_cache_value": {
                const res = await cacheService.withCache<BoxResult>({
                  method: "extract",
                  page,
                  data: { instruction: op.key },
                  context,
                  logger: testLogger(),
                  onHit: (v) => makeBox(String(v)),
                  execute: async () => ({ result: makeBox("failed-act"), cacheValue: undefined }),
                });
                expect(res.data).toBe("failed-act");
                expect(setSpy).not.toHaveBeenCalled();
                expect(store).toStrictEqual(snapshotBefore);
                break;
              }
              case "read_error_then_success": {
                const res = await cacheService.withCache<BoxResult>({
                  method: "extract",
                  page,
                  data: { instruction: op.key },
                  context,
                  logger: testLogger(),
                  onHit: (v) => makeBox(String(v)),
                  execute: async () => ({ result: makeBox(op.value), cacheValue: op.value }),
                });
                expect(res.data).toBe(op.value);
                expect(res.metadata.cache).toStrictEqual({
                  status: "MISS",
                  missReason: "read_failed",
                });
                expect(store.get(op.key)).toBe(op.value);
                break;
              }
              case "read_payload_too_large": {
                const res = await cacheService.withCache<BoxResult>({
                  method: "extract",
                  page,
                  data: { instruction: op.key },
                  context,
                  logger: testLogger(),
                  onHit: (v) => makeBox(String(v)),
                  execute: async () => ({ result: makeBox(op.value), cacheValue: op.value }),
                });
                expect(res.data).toBe(op.value);
                expect(res.metadata.cache).toStrictEqual({
                  status: "MISS",
                  missReason: "payload_too_large",
                });
                expect(setSpy).not.toHaveBeenCalled();
                expect(store).toStrictEqual(snapshotBefore);
                break;
              }
              case "write_error_on_miss": {
                const res = await cacheService.withCache<BoxResult>({
                  method: "extract",
                  page,
                  data: { instruction: op.key },
                  context,
                  logger: testLogger(),
                  onHit: (v) => makeBox(String(v)),
                  execute: async () => ({ result: makeBox(op.value), cacheValue: op.value }),
                });
                expect(res.data).toBe(op.value);
                expect(res.metadata.cache.status).toBe("MISS");
                expect(store).toStrictEqual(snapshotBefore);
                break;
              }
              case "bypass": {
                const res = await cacheService.withCache<BoxResult>({
                  method: "extract",
                  page,
                  data: { instruction: op.key },
                  bypass: true,
                  context,
                  logger: testLogger(),
                  onHit: (v) => makeBox(String(v)),
                  execute: async () => ({ result: makeBox(op.value), cacheValue: op.value }),
                });
                expect(res.data).toBe(op.value);
                expect(res.metadata.cache).toStrictEqual({ status: "DISABLED" });
                expect(getSpy).not.toHaveBeenCalled();
                expect(setSpy).not.toHaveBeenCalled();
                expect(store).toStrictEqual(snapshotBefore);
                break;
              }
              default: {
                const _exhaustive: never = op;
                throw new Error(`Unhandled cache op: ${String(_exhaustive)}`);
              }
            }
          }
        }),
        { seed: BASE_SEED + 30, numRuns: 50 },
      );
    });
  });
});
