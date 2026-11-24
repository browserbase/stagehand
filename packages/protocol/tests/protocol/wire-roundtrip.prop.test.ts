import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import {
  JSONRPCErrorResponseSchema,
  JSONRPCMessageSchema,
  JSONRPCNotificationSchema,
  JSONRPCRequestSchema,
  JSONRPCResponseSchema,
  JSONRPCSuccessResponseSchema,
} from "../../json-rpc/schemas.js";
import { encodeWireValue, type WireCasingOptions, wireSchema } from "../../json-rpc/wire-casing.js";
import {
  StagehandMethods,
  StagehandNotifications,
  StagehandRpcNotificationSchema,
  StagehandRpcRequestSchema,
} from "../../schema-registry.js";
import {
  ActionSchema,
  BrowserbaseRequestResultSchema,
  CallbackBatchParamsSchema,
  ContextSetExtraHTTPHeadersParamsSchema,
  DomainPolicySchema,
  LLMGenerateResultSchema,
  LLMMessageContentBlockSchema,
  LLMResponseFormatSchema,
  LocatorChainSchema,
  LocatorQuerySelectorSchema,
  LocatorStepSchema,
  ModelAuthSchema,
  ModelProviderOptionsSchema,
  PageEventNotificationSchema,
  PageScreenshotOptionsSchema,
  PageSetExtraHTTPHeadersParamsSchema,
  ProxyConfigSchema,
  StagehandResultUsageSchema,
} from "../../schemas.js";
import {
  browserbaseCancelParamsArb,
  callbackBatchParamsArb,
  contextSetDomainPolicyParamsArb,
  edgeKeyArb,
  edgeStringArb,
  jsonRpcErrorResponseArb,
  jsonRpcNotificationArb,
  jsonRpcRequestArb,
  jsonRpcSuccessResponseArb,
  jsonValueArb,
  llmGenerateResultWithToolUseArb,
  locatorClickParamsArb,
  locatorFrameStepArb,
  locatorNthStepArb,
  locatorStepArb,
  nonEmptyStringArb,
  pageCDPEventNotificationArb,
  pageEventNotificationArb,
  pageGotoParamsArb,
  pagePDFParamsArb,
  pageScreenshotClipArb,
  PROTOCOL_CASES,
  requestIdArb,
  safeIntArb,
  stagehandExtractParamsArb,
  stagehandLogArb,
  trickyKeySeeds,
} from "./wire-roundtrip-fixtures.js";

const NUM_RUNS = 60;

/**
 * Structural deep-equality that avoids Vitest's `toStrictEqual` false-negative
 * when an opaque map contains an own `"constructor"` property whose value is
 * a fresh object or array (Vitest compares `a.constructor === b.constructor`).
 */
function assertStructurallyEqual(actual: unknown, expected: unknown, pathLabel = "$"): void {
  if (Object.is(actual, expected)) return;
  if (typeof actual !== typeof expected || actual === null || expected === null) {
    expect(actual, `mismatch at ${pathLabel}`).toEqual(expected);
    return;
  }
  if (Array.isArray(actual) || Array.isArray(expected)) {
    expect(Array.isArray(actual), `expected array at ${pathLabel}`).toBe(Array.isArray(expected));
    const aArr = actual as unknown[];
    const eArr = expected as unknown[];
    expect(aArr.length, `array length mismatch at ${pathLabel}`).toBe(eArr.length);
    for (let i = 0; i < eArr.length; i++) {
      assertStructurallyEqual(aArr[i], eArr[i], `${pathLabel}[${i}]`);
    }
    return;
  }
  if (typeof actual === "object" && typeof expected === "object") {
    const aObj = actual as Record<string, unknown>;
    const eObj = expected as Record<string, unknown>;
    const aKeys = Object.keys(aObj).sort();
    const eKeys = Object.keys(eObj).sort();
    expect(aKeys, `keys mismatch at ${pathLabel}`).toStrictEqual(eKeys);
    for (const key of eKeys) {
      assertStructurallyEqual(aObj[key], eObj[key], `${pathLabel}.${key}`);
    }
    return;
  }
  expect(actual, `value mismatch at ${pathLabel}`).toBe(expected);
}

function assertWireRoundTrip<TSchema extends z.ZodType>(
  schema: TSchema,
  apiValue: unknown,
  wireOptions?: WireCasingOptions,
): void {
  const parsed = schema.parse(apiValue);
  const wire = encodeWireValue(parsed, wireOptions);
  const wireJson = JSON.stringify(wire);
  const reparsedWire: unknown = JSON.parse(wireJson);
  const decoded = wireSchema(schema, wireOptions).parse(reparsedWire);

  assertStructurallyEqual(decoded, parsed, "decoded");
  assertStructurallyEqual(encodeWireValue(decoded, wireOptions), reparsedWire, "reencodedWire");
}

describe("protocol wire round-trip properties (fast-check)", () => {
  it.each(PROTOCOL_CASES)(
    "$name: Zod parse -> encodeWireValue -> JSON -> wireSchema is lossless and idempotent",
    ({ schema, arb, wire }) => {
      fc.assert(
        fc.property(arb, (value) => {
          assertWireRoundTrip(schema, value, wire);
        }),
        { numRuns: NUM_RUNS },
      );
    },
  );

  it("preserves tool_use input keys across llm.generate resultWire round-trips", () => {
    fc.assert(
      fc.property(llmGenerateResultWithToolUseArb, (result) => {
        assertWireRoundTrip(
          LLMGenerateResultSchema,
          result,
          StagehandMethods.llmGenerate.resultWire,
        );
      }),
      { numRuns: NUM_RUNS, seed: 20261126 },
    );
  });

  it("JSON-RPC request, response, notification, and error envelopes round-trip losslessly", () => {
    fc.assert(
      fc.property(jsonRpcRequestArb, (req) => {
        const parsed = JSONRPCRequestSchema.parse(req);
        const reparsed = JSONRPCMessageSchema.parse(JSON.parse(JSON.stringify(parsed)));
        assertStructurallyEqual(reparsed, parsed, "JSONRPCRequest");
      }),
      { numRuns: NUM_RUNS },
    );

    fc.assert(
      fc.property(jsonRpcNotificationArb, (notif) => {
        const parsed = JSONRPCNotificationSchema.parse(notif);
        const reparsed = JSONRPCMessageSchema.parse(JSON.parse(JSON.stringify(parsed)));
        assertStructurallyEqual(reparsed, parsed, "JSONRPCNotification");
      }),
      { numRuns: NUM_RUNS },
    );

    fc.assert(
      fc.property(jsonRpcSuccessResponseArb, (res) => {
        const parsed = JSONRPCSuccessResponseSchema.parse(res);
        const reparsed = JSONRPCResponseSchema.parse(JSON.parse(JSON.stringify(parsed)));
        assertStructurallyEqual(reparsed, parsed, "JSONRPCSuccessResponse");
      }),
      { numRuns: NUM_RUNS },
    );

    fc.assert(
      fc.property(jsonRpcErrorResponseArb, (err) => {
        const parsed = JSONRPCErrorResponseSchema.parse(err);
        const reparsed = JSONRPCResponseSchema.parse(JSON.parse(JSON.stringify(parsed)));
        assertStructurallyEqual(reparsed, parsed, "JSONRPCErrorResponse");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("StagehandRpcRequestSchema and StagehandRpcNotificationSchema decode fuzzed wire envelopes", () => {
    const rpcCases = [
      { method: StagehandMethods.stagehandCallbackBatch, arb: callbackBatchParamsArb },
      { method: StagehandMethods.contextSetDomainPolicy, arb: contextSetDomainPolicyParamsArb },
      { method: StagehandMethods.pageGoto, arb: pageGotoParamsArb },
      { method: StagehandMethods.pagePDF, arb: pagePDFParamsArb },
      { method: StagehandMethods.locatorClick, arb: locatorClickParamsArb },
      { method: StagehandMethods.stagehandExtract, arb: stagehandExtractParamsArb },
    ] as const;

    for (const { method, arb } of rpcCases) {
      fc.assert(
        fc.property(requestIdArb, arb, (id, apiParams) => {
          const parsedApi = method.params.parse(apiParams);
          const wireParams = encodeWireValue(
            parsedApi,
            "paramsWire" in method ? method.paramsWire : undefined,
          );
          const envelope = StagehandRpcRequestSchema.parse(
            JSON.parse(
              JSON.stringify({
                jsonrpc: "2.0",
                id,
                method: method.name,
                params: wireParams,
              }),
            ),
          );
          expect(envelope.method).toBe(method.name);
          expect(envelope.id).toBe(id);
          assertStructurallyEqual(
            envelope.params,
            parsedApi,
            `StagehandRpcRequest(${method.name})`,
          );
        }),
        { numRuns: 30 },
      );
    }

    const notifCases = [
      { notif: StagehandNotifications.browserbaseCancel, arb: browserbaseCancelParamsArb },
      { notif: StagehandNotifications.log, arb: stagehandLogArb },
      { notif: StagehandNotifications.pageCDPEvent, arb: pageCDPEventNotificationArb },
      { notif: StagehandNotifications.pageEvent, arb: pageEventNotificationArb },
    ] as const;

    for (const { notif, arb } of notifCases) {
      fc.assert(
        fc.property(arb, (apiParams) => {
          const parsedApi = notif.params.parse(apiParams);
          const wireParams = encodeWireValue(parsedApi, notif.paramsWire);
          const envelope = StagehandRpcNotificationSchema.parse(
            JSON.parse(
              JSON.stringify({
                jsonrpc: "2.0",
                method: notif.name,
                params: wireParams,
              }),
            ),
          );
          expect(envelope.method).toBe(notif.name);
          assertStructurallyEqual(
            envelope.params,
            parsedApi,
            `StagehandRpcNotification(${notif.name})`,
          );
        }),
        { numRuns: 30 },
      );
    }
  });
});

describe("protocol fail-closed rejection properties (fast-check)", () => {
  it("rejects unknown discriminated union tags across all protocol unions", () => {
    const unknownTagArb = (known: readonly string[]) =>
      edgeStringArb.filter((s) => !known.includes(s));

    fc.assert(
      fc.property(unknownTagArb(["css", "xpath", "text"]), nonEmptyStringArb, (kind, value) => {
        expect(wireSchema(LocatorQuerySelectorSchema).safeParse({ kind, value }).success).toBe(
          false,
        );
      }),
      { numRuns: NUM_RUNS },
    );

    fc.assert(
      fc.property(unknownTagArb(["query", "frame", "nth"]), (type) => {
        expect(
          wireSchema(LocatorStepSchema).safeParse({
            type,
            selector: { kind: "css", value: "a" },
          }).success,
        ).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );

    fc.assert(
      fc.property(unknownTagArb(["response", "error"]), (type) => {
        expect(
          wireSchema(BrowserbaseRequestResultSchema).safeParse({
            type,
            reason: "network",
            message: "x",
          }).success,
        ).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );

    fc.assert(
      fc.property(unknownTagArb(["toolsadded", "toolsremoved", "response"]), (event) => {
        expect(
          wireSchema(PageEventNotificationSchema).safeParse({
            subscription_id: "s1",
            page_id: "p1",
            session_id: "sess1",
            target_id: "t1",
            event,
            tools: [],
          }).success,
        ).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );

    fc.assert(
      fc.property(unknownTagArb(["text", "json_schema"]), (type) => {
        expect(wireSchema(LLMResponseFormatSchema).safeParse({ type }).success).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );

    fc.assert(
      fc.property(unknownTagArb(["text", "json_schema"]), (outputFormat) => {
        expect(
          wireSchema(LLMGenerateResultSchema).safeParse({
            role: "assistant",
            content: { type: "text", text: "hi" },
            output_format: outputFormat,
          }).success,
        ).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );

    fc.assert(
      fc.property(unknownTagArb(["text", "image", "tool_use", "tool_result"]), (type) => {
        expect(
          wireSchema(LLMMessageContentBlockSchema).safeParse({ type, text: "hi" }).success,
        ).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );

    fc.assert(
      fc.property(unknownTagArb(["browserbase", "external"]), (type) => {
        expect(
          wireSchema(ProxyConfigSchema).safeParse({ type, server: "http://proxy" }).success,
        ).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );

    fc.assert(
      fc.property(unknownTagArb(["apiKey", "googleServiceAccount", "azureEntraId"]), (type) => {
        expect(wireSchema(ModelAuthSchema).safeParse({ type, api_key: "k" }).success).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );

    fc.assert(
      fc.property(unknownTagArb(["vertex", "azure"]), (type) => {
        expect(
          wireSchema(ModelProviderOptionsSchema).safeParse({ type, options: {} }).success,
        ).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects extra unknown keys on strict protocol objects", () => {
    const unknownFieldArb = fc
      .stringMatching(/^[a-z][a-z0-9_]{2,14}$/)
      .filter(
        (key) =>
          ![
            "allowed_domains",
            "blocked_domains",
            "input_tokens",
            "output_tokens",
            "reasoning_tokens",
            "cached_input_tokens",
            "inference_time_ms",
            "page_id",
            "url",
            "options",
            "selector",
            "description",
            "method",
            "arguments",
          ].includes(key),
      );

    fc.assert(
      fc.property(unknownFieldArb, jsonValueArb, (extraKey, extraVal) => {
        expect(wireSchema(DomainPolicySchema).safeParse({ [extraKey]: extraVal }).success).toBe(
          false,
        );
        expect(
          wireSchema(StagehandResultUsageSchema).safeParse({ [extraKey]: extraVal }).success,
        ).toBe(false);
        expect(
          wireSchema(ActionSchema).safeParse({
            selector: "#a",
            description: "click",
            [extraKey]: extraVal,
          }).success,
        ).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects malformed locator chains, cross-field violations, and invalid JSON-RPC envelopes", () => {
    expect(wireSchema(LocatorChainSchema).safeParse({ steps: [] }).success).toBe(false);
    fc.assert(
      fc.property(
        fc.oneof(locatorFrameStepArb, locatorNthStepArb),
        fc.array(locatorStepArb, { maxLength: 3 }),
        (badFirst, rest) => {
          expect(
            wireSchema(LocatorChainSchema).safeParse({ steps: [badFirst, ...rest] }).success,
          ).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );

    fc.assert(
      fc.property(pageScreenshotClipArb, (clip) => {
        expect(
          wireSchema(PageScreenshotOptionsSchema).safeParse({ full_page: true, clip }).success,
        ).toBe(false);
      }),
      { numRuns: 30 },
    );
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (quality) => {
        expect(wireSchema(PageScreenshotOptionsSchema).safeParse({ quality }).success).toBe(false);
        expect(
          wireSchema(PageScreenshotOptionsSchema).safeParse({ type: "png", quality }).success,
        ).toBe(false);
      }),
      { numRuns: 30 },
    );

    fc.assert(
      fc.property(
        fc.string().filter((v) => v !== "2.0"),
        requestIdArb,
        (badVersion, id) => {
          expect(
            JSONRPCMessageSchema.safeParse({ jsonrpc: badVersion, id, method: "page.url" }).success,
          ).toBe(false);
        },
      ),
      { numRuns: 30 },
    );

    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -100_000, max: -1 }),
          fc
            .double({ min: 0.1, max: 100, noNaN: true, noDefaultInfinity: true })
            .filter((n) => !Number.isInteger(n)),
          fc.string(),
        ),
        (badId) => {
          expect(
            JSONRPCRequestSchema.safeParse({ jsonrpc: "2.0", id: badId, method: "page.url" })
              .success,
          ).toBe(false);
        },
      ),
      { numRuns: 30 },
    );

    fc.assert(
      fc.property(
        requestIdArb,
        jsonValueArb,
        safeIntArb,
        edgeStringArb,
        (id, result, code, msg) => {
          expect(
            JSONRPCResponseSchema.safeParse({
              jsonrpc: "2.0",
              id,
              result,
              error: { code, message: msg },
            }).success,
          ).toBe(false);
        },
      ),
      { numRuns: 30 },
    );

    const registeredMethods = new Set<string>(Object.values(StagehandMethods).map((m) => m.name));
    fc.assert(
      fc.property(
        requestIdArb,
        edgeStringArb.filter((m) => !registeredMethods.has(m)),
        (id, unknownMethod) => {
          expect(
            StagehandRpcRequestSchema.safeParse({
              jsonrpc: "2.0",
              id,
              method: unknownMethod,
              params: {},
            }).success,
          ).toBe(false);
        },
      ),
      { numRuns: 30 },
    );
  });
});

describe("edge-case strings, opaque keys, and prototype-pollution hardening", () => {
  it("preserves arbitrary unicode, empty, numeric, dotted, and acronym-like keys in opaque maps", () => {
    const specialMapArb = fc.dictionary(
      fc.oneof(fc.constantFrom(...trickyKeySeeds), edgeKeyArb),
      edgeStringArb,
      { minKeys: 1, maxKeys: 8 },
    );

    fc.assert(
      fc.property(edgeStringArb, specialMapArb, (pageId, headers) => {
        assertWireRoundTrip(
          PageSetExtraHTTPHeadersParamsSchema,
          { pageId, headers },
          StagehandMethods.pageSetExtraHTTPHeaders.paramsWire,
        );
      }),
      { numRuns: NUM_RUNS },
    );

    fc.assert(
      fc.property(
        nonEmptyStringArb,
        fc.dictionary(fc.constantFrom(...trickyKeySeeds), jsonValueArb, { minKeys: 1, maxKeys: 6 }),
        (callbackSource, input) => {
          assertWireRoundTrip(
            CallbackBatchParamsSchema,
            { callbackSource, input, options: { timeout: 5_000 } },
            StagehandMethods.stagehandCallbackBatch.paramsWire,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("strips own __proto__ keys defensively and never pollutes Object.prototype", () => {
    const protoPayloads = [
      '{"__proto__":{"polluted":true}}',
      '{"headers":{"__proto__":"evil","X-Ok":"1"}}',
      '{"callback_source":"() => 1","input":{"__proto__":{"polluted":true},"ok":1},"options":{"timeout":1000}}',
    ];

    for (const rawJson of protoPayloads) {
      const parsed: unknown = JSON.parse(rawJson);
      wireSchema(DomainPolicySchema).safeParse(parsed);
      wireSchema(
        ContextSetExtraHTTPHeadersParamsSchema,
        StagehandMethods.contextSetExtraHTTPHeaders.paramsWire,
      ).safeParse(parsed);
      wireSchema(
        CallbackBatchParamsSchema,
        StagehandMethods.stagehandCallbackBatch.paramsWire,
      ).safeParse(parsed);

      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    }

    const decodedHeaders = wireSchema(
      ContextSetExtraHTTPHeadersParamsSchema,
      StagehandMethods.contextSetExtraHTTPHeaders.paramsWire,
    ).parse(JSON.parse('{"headers":{"__proto__":"evil","X-Ok":"1"}}'));
    expect(Object.keys(decodedHeaders.headers)).toStrictEqual(["X-Ok"]);
    expect(decodedHeaders.headers["X-Ok"]).toBe("1");
  });
});
