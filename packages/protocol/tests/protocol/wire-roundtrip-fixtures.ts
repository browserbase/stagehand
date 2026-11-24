import fc from "fast-check";
import { z } from "zod/v4";
import {
  JSONRPCErrorResponseSchema,
  JSONRPCNotificationSchema,
  JSONRPCRequestSchema,
  JSONRPCSuccessResponseSchema,
} from "../../json-rpc/schemas.js";
import type { WireCasingOptions } from "../../json-rpc/wire-casing.js";
import { StagehandMethods, StagehandNotifications } from "../../schema-registry.js";
import {
  ActResultSchema,
  BrowserbaseCancelParamsSchema,
  BrowserbaseRequestParamsSchema,
  BrowserbaseRequestResultSchema,
  CacheMetadataSchema,
  CallbackBatchOptionsSchema,
  CallbackBatchParamsSchema,
  CallbackBatchResultSchema,
  ContextAddCookiesParamsSchema,
  ContextClearCookiesParamsSchema,
  ContextClipboardPasteParamsSchema,
  ContextGetDomainPolicyResultSchema,
  ContextSetDomainPolicyParamsSchema,
  ContextSetExtraHTTPHeadersParamsSchema,
  DomainPolicySchema,
  ExtractResultSchema,
  LLMGenerateParamsSchema,
  LLMGenerateResultSchema,
  LocatorChainSchema,
  LocatorClickParamsSchema,
  LocatorHighlightParamsSchema,
  LocatorInputSchema,
  LocatorParamsSchema,
  LocatorRequestDescriptorSchema,
  LocatorSetInputFilesParamsSchema,
  MAX_CALLBACK_BATCH_TIMEOUT_MS,
  ObserveResultSchema,
  PageCDPEventNotificationSchema,
  PageClickParamsSchema,
  PageDragAndDropParamsSchema,
  PageEventNotificationSchema,
  PageGotoParamsSchema,
  PagePDFParamsSchema,
  PageScreenshotParamsSchema,
  PageSetExtraHTTPHeadersParamsSchema,
  PageSetViewportSizeParamsSchema,
  PageSnapshotParamsSchema,
  PageTypeParamsSchema,
  PageWaitForFunctionParamsSchema,
  PageWaitForSelectorParamsSchema,
  PageWebMCPInvokeToolParamsSchema,
  PageWebMCPToolsResultSchema,
  STAGEHAND_PROTOCOL_VERSION,
  StagehandActParamsSchema,
  StagehandExtractParamsSchema,
  StagehandInitParamsSchema,
  StagehandLogSchema,
  StagehandObserveParamsSchema,
  StagehandResultMetadataSchema,
  StagehandResultUsageSchema,
  WebMCPToolResponseSchema,
} from "../../schemas.js";

export const MAX_SAFE_INT = Number.MAX_SAFE_INTEGER;

export function omitUndefined<T extends Record<string, unknown>>(record: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as Partial<T>;
}

export function normalizeZero(n: number): number {
  return Object.is(n, -0) ? 0 : n;
}

export const optional = <T>(arb: fc.Arbitrary<T>) => fc.option(arb, { nil: undefined });

export const finiteFloatArb = fc
  .double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true })
  .map(normalizeZero);

export const nonNegFloatArb = fc
  .double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true })
  .map(normalizeZero);

export const posFloatArb = fc
  .double({ min: 0.001, max: 1e6, noNaN: true, noDefaultInfinity: true })
  .map(normalizeZero);

export const nonNegIntArb = fc.integer({ min: 0, max: 1_000_000 });
export const posIntArb = fc.integer({ min: 1, max: 1_000_000 });
export const safeIntArb = fc.integer({ min: -1_000_000, max: 1_000_000 });
export const requestIdArb = fc.oneof(
  fc.integer({ min: 0, max: 100_000 }),
  fc.constantFrom(0, 1, 42, MAX_SAFE_INT),
);

export const trickyKeySeeds = [
  "",
  "0",
  "123",
  "-1",
  "1e5",
  "a.b",
  "a.b.c",
  "foo_bar",
  "fooBar",
  "FOO_BAR",
  "X-Request-ID",
  "base_url",
  "baseURL",
  "prefer_css_page_size",
  "preferCSSPageSize",
  "constructor",
  "toString",
  "hasOwnProperty",
  "valueOf",
  "prototype",
  "café_日本語_🚀",
  "مرحبا",
  "line1\nline2",
  "nul\u0000byte",
  "   ",
];

// Exclude "__proto__" from generic safe-record keys because Zod v4 strips own
// "__proto__" properties defensively; dedicated tests cover "__proto__" explicitly.
export const edgeKeyArb = fc
  .oneof(
    fc.constantFrom(...trickyKeySeeds),
    fc.string({ minLength: 0, maxLength: 24 }),
    fc.string({ unit: "grapheme", minLength: 0, maxLength: 12 }),
  )
  .filter((key) => key !== "__proto__");

export const edgeStringArb = fc.oneof(
  fc.constantFrom(...trickyKeySeeds),
  fc.string({ minLength: 0, maxLength: 40 }),
  fc.string({ unit: "grapheme", minLength: 0, maxLength: 16 }),
);

export const nonEmptyStringArb = edgeStringArb.filter((s) => s.length > 0);

export const base64Arb = fc
  .uint8Array({ minLength: 0, maxLength: 32 })
  .map((bytes) => Buffer.from(bytes).toString("base64"));

export const httpUrlArb = fc
  .tuple(
    fc.constantFrom("http", "https"),
    fc.constantFrom("example.com", "sub.example.org", "localhost", "127.0.0.1"),
    fc.option(fc.integer({ min: 80, max: 65535 }), { nil: undefined }),
    fc.array(fc.stringMatching(/^[a-z0-9_-]{1,8}$/), { maxLength: 3 }),
  )
  .map(([scheme, host, port, segments]) => {
    const portPart = port !== undefined ? `:${port}` : "";
    const pathPart = segments.length > 0 ? `/${segments.join("/")}` : "";
    return `${scheme}://${host}${portPart}${pathPart}`;
  });

export const traceEndpointUrlArb = httpUrlArb.map((base) => `${base.replace(/\/$/, "")}/v1/traces`);

export const jsonValueArb: fc.Arbitrary<z.infer<ReturnType<typeof z.json>>> = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: "small" },
    fc.constant(null),
    fc.boolean(),
    safeIntArb,
    finiteFloatArb,
    edgeStringArb,
    fc.array(tie("value") as fc.Arbitrary<z.infer<ReturnType<typeof z.json>>>, { maxLength: 4 }),
    fc.dictionary(edgeKeyArb, tie("value") as fc.Arbitrary<z.infer<ReturnType<typeof z.json>>>, {
      maxKeys: 4,
    }),
  ),
})).value;

export const jsonObjectArb = fc.dictionary(edgeKeyArb, jsonValueArb, { maxKeys: 5 });
export const stringMapArb = fc.dictionary(edgeKeyArb, edgeStringArb, { maxKeys: 5 });

export const modelNameArb = fc
  .tuple(
    fc.constantFrom("openai", "anthropic", "google", "groq", "cerebras"),
    fc.stringMatching(/^[A-Za-z0-9._:/-]{1,24}$/),
  )
  .map(([provider, modelId]) => `${provider}/${modelId}`);

export const modelConfigArb = fc
  .record({
    modelName: modelNameArb,
    apiKey: optional(nonEmptyStringArb),
    headers: optional(stringMapArb),
  })
  .map(omitUndefined);

const variablePrimitiveArb = fc.oneof(edgeStringArb, finiteFloatArb, fc.boolean());
const variableValueArb = fc.oneof(
  variablePrimitiveArb,
  fc
    .record({
      value: variablePrimitiveArb,
      description: optional(edgeStringArb),
    })
    .map(omitUndefined),
);
const variablesArb = fc.dictionary(edgeKeyArb, variableValueArb, { maxKeys: 4 });

const cachingArb = fc.oneof(
  fc.boolean(),
  fc.record({ threshold: optional(posIntArb) }).map(omitUndefined),
);

export const locatorQuerySelectorArb = fc.oneof(
  fc.record({ kind: fc.constant("css" as const), value: nonEmptyStringArb }),
  fc.record({ kind: fc.constant("xpath" as const), value: nonEmptyStringArb }),
  fc.record({ kind: fc.constant("text" as const), value: nonEmptyStringArb }),
);

export const locatorQueryStepArb = fc.record({
  type: fc.constant("query" as const),
  selector: locatorQuerySelectorArb,
});

export const locatorFrameStepArb = fc.record({
  type: fc.constant("frame" as const),
  selector: locatorQuerySelectorArb,
});

export const locatorNthStepArb = fc.record({
  type: fc.constant("nth" as const),
  index: nonNegIntArb,
});

export const locatorStepArb = fc.oneof(locatorQueryStepArb, locatorFrameStepArb, locatorNthStepArb);

export const locatorChainArb = fc
  .tuple(locatorQueryStepArb, fc.array(locatorStepArb, { maxLength: 4 }))
  .map(([first, rest]) => ({ steps: [first, ...rest] }));

const legacyLocatorArb = fc
  .record({
    selector: nonEmptyStringArb,
    nth: optional(nonNegIntArb),
  })
  .map(omitUndefined);

const chainLocatorArb = fc.record({ chain: locatorChainArb });
export const locatorInputArb = fc.oneof(legacyLocatorArb, chainLocatorArb);

export const locatorRequestDescriptorArb = fc.oneof(
  fc
    .record({
      pageId: edgeStringArb,
      selector: nonEmptyStringArb,
      nth: optional(nonNegIntArb),
    })
    .map(omitUndefined),
  fc.record({
    pageId: edgeStringArb,
    chain: locatorChainArb,
  }),
);

const locatorOptionsArb = fc.record({ timeout: optional(nonNegFloatArb) }).map(omitUndefined);
const mouseButtonArb = fc.constantFrom("left" as const, "right" as const, "middle" as const);

export const locatorParamsArb = fc
  .tuple(locatorRequestDescriptorArb, optional(locatorOptionsArb))
  .map(([desc, options]) => omitUndefined({ ...desc, options }));

export const locatorClickParamsArb = fc
  .tuple(
    locatorRequestDescriptorArb,
    optional(
      fc
        .record({
          timeout: optional(nonNegFloatArb),
          button: optional(mouseButtonArb),
          clickCount: optional(posIntArb),
        })
        .map(omitUndefined),
    ),
  )
  .map(([desc, options]) => omitUndefined({ ...desc, options }));

const rgbaColorArb = fc
  .record({
    r: finiteFloatArb,
    g: finiteFloatArb,
    b: finiteFloatArb,
    a: optional(finiteFloatArb),
  })
  .map(omitUndefined);

export const locatorHighlightParamsArb = fc
  .tuple(
    locatorRequestDescriptorArb,
    optional(
      fc
        .record({
          timeout: optional(nonNegFloatArb),
          durationMs: optional(nonNegIntArb),
          borderColor: optional(rgbaColorArb),
          contentColor: optional(rgbaColorArb),
        })
        .map(omitUndefined),
    ),
  )
  .map(([desc, options]) => omitUndefined({ ...desc, options }));

export const inputFilePayloadArb = fc
  .record({
    name: nonEmptyStringArb,
    mimeType: optional(nonEmptyStringArb),
    data: base64Arb,
    lastModified: optional(nonNegIntArb),
  })
  .map(omitUndefined);

export const locatorSetInputFilesParamsArb = fc
  .tuple(
    locatorRequestDescriptorArb,
    fc.array(inputFilePayloadArb, { maxLength: 3 }),
    optional(locatorOptionsArb),
  )
  .map(([desc, files, options]) => omitUndefined({ ...desc, files, options }));

export const domainPolicyArb = fc
  .record({
    allowedDomains: optional(fc.array(edgeStringArb, { maxLength: 5 })),
    blockedDomains: optional(fc.array(edgeStringArb, { maxLength: 5 })),
  })
  .map(omitUndefined);

export const contextSetDomainPolicyParamsArb = fc.record({
  policy: fc.option(domainPolicyArb, { nil: null }),
});

export const contextGetDomainPolicyResultArb = fc.option(domainPolicyArb, { nil: null });

export const stagehandResultUsageArb = fc.record({
  inputTokens: nonNegIntArb,
  outputTokens: nonNegIntArb,
  reasoningTokens: nonNegIntArb,
  cachedInputTokens: nonNegIntArb,
  inferenceTimeMs: nonNegIntArb,
});

const cacheTokenSavingsArb = fc.record({
  inputTokens: nonNegIntArb,
  outputTokens: nonNegIntArb,
  totalTokens: nonNegIntArb,
});

export const cacheMetadataArb = fc
  .record({
    status: fc.constantFrom("HIT" as const, "MISS" as const, "DISABLED" as const),
    count: optional(nonNegIntArb),
    threshold: optional(posIntArb),
    missReason: optional(edgeStringArb),
    tokensSaved: optional(cacheTokenSavingsArb),
  })
  .map(omitUndefined);

export const stagehandResultMetadataArb = fc
  .record({
    actionId: optional(edgeStringArb),
    cache: cacheMetadataArb,
    usage: stagehandResultUsageArb,
  })
  .map(omitUndefined);

export const actionArb = fc
  .record({
    selector: edgeStringArb,
    description: edgeStringArb,
    method: optional(edgeStringArb),
    arguments: optional(fc.array(edgeStringArb, { maxLength: 4 })),
  })
  .map(omitUndefined);

export const actResultArb = fc.record({
  data: fc.record({
    success: fc.boolean(),
    message: edgeStringArb,
    actionDescription: edgeStringArb,
    actions: fc.array(actionArb, { maxLength: 3 }),
  }),
  metadata: stagehandResultMetadataArb,
});

export const observeResultArb = fc.record({
  data: fc.array(actionArb, { maxLength: 4 }),
  metadata: stagehandResultMetadataArb,
});

export const extractResultArb = fc.record({
  data: jsonValueArb,
  metadata: stagehandResultMetadataArb,
});

export const callbackBatchOptionsArb = fc
  .record({
    pageId: optional(nonEmptyStringArb),
    timeout: fc.integer({ min: 1, max: MAX_CALLBACK_BATCH_TIMEOUT_MS }),
  })
  .map(omitUndefined);

export const callbackBatchParamsArb = fc
  .record({
    callbackSource: nonEmptyStringArb,
    input: optional(jsonValueArb),
    options: callbackBatchOptionsArb,
  })
  .map(omitUndefined);

export const callbackBatchResultArb = fc
  .record({
    value: optional(jsonValueArb),
  })
  .map(omitUndefined);

const loadStateArb = fc.constantFrom(
  "load" as const,
  "domcontentloaded" as const,
  "networkidle" as const,
);

const pageNavigationOptionsArb = fc
  .record({
    waitUntil: optional(loadStateArb),
    timeout: optional(posIntArb),
  })
  .map(omitUndefined);

export const pageGotoParamsArb = fc
  .record({
    pageId: edgeStringArb,
    url: nonEmptyStringArb,
    options: optional(pageNavigationOptionsArb),
  })
  .map(omitUndefined);

export const pageClickParamsArb = fc
  .record({
    pageId: edgeStringArb,
    x: finiteFloatArb,
    y: finiteFloatArb,
    options: optional(
      fc
        .record({
          button: optional(mouseButtonArb),
          clickCount: optional(posIntArb),
        })
        .map(omitUndefined),
    ),
  })
  .map(omitUndefined);

export const pageDragAndDropParamsArb = fc
  .record({
    pageId: edgeStringArb,
    fromX: finiteFloatArb,
    fromY: finiteFloatArb,
    toX: finiteFloatArb,
    toY: finiteFloatArb,
    options: optional(
      fc
        .record({
          button: optional(mouseButtonArb),
          steps: optional(posIntArb),
          delay: optional(nonNegFloatArb),
          route: optional(
            fc.array(fc.record({ x: finiteFloatArb, y: finiteFloatArb }), { maxLength: 4 }),
          ),
        })
        .map(omitUndefined),
    ),
  })
  .map(omitUndefined);

export const pageScreenshotClipArb = fc.record({
  x: finiteFloatArb,
  y: finiteFloatArb,
  width: posFloatArb,
  height: posFloatArb,
});

export const pageScreenshotOptionsArb = fc
  .record({
    animations: optional(fc.constantFrom("disabled" as const, "allow" as const)),
    caret: optional(fc.constantFrom("hide" as const, "initial" as const)),
    layoutMode: fc.constantFrom("none", "fullPage", "clip"),
    clip: pageScreenshotClipArb,
    mask: optional(fc.array(locatorRequestDescriptorArb, { maxLength: 2 })),
    maskColor: optional(edgeStringArb),
    omitBackground: optional(fc.boolean()),
    imageType: optional(fc.constantFrom("png" as const, "jpeg" as const)),
    quality: optional(fc.integer({ min: 0, max: 100 })),
    scale: optional(fc.constantFrom("css" as const, "device" as const)),
    style: optional(edgeStringArb),
    timeout: optional(nonNegFloatArb),
  })
  .map((raw) =>
    omitUndefined({
      animations: raw.animations,
      caret: raw.caret,
      fullPage:
        raw.layoutMode === "fullPage" ? true : raw.layoutMode === "none" ? undefined : false,
      clip: raw.layoutMode === "clip" ? raw.clip : undefined,
      mask: raw.mask,
      maskColor: raw.maskColor,
      omitBackground: raw.omitBackground,
      type: raw.imageType,
      quality: raw.imageType === "jpeg" ? raw.quality : undefined,
      scale: raw.scale,
      style: raw.style,
      timeout: raw.timeout,
    }),
  );

export const pageScreenshotParamsArb = fc
  .record({
    pageId: edgeStringArb,
    options: optional(pageScreenshotOptionsArb),
  })
  .map(omitUndefined);

export const pagePDFParamsArb = fc
  .record({
    pageId: edgeStringArb,
    options: optional(
      fc
        .record({
          landscape: optional(fc.boolean()),
          displayHeaderFooter: optional(fc.boolean()),
          printBackground: optional(fc.boolean()),
          scale: optional(
            fc
              .double({ min: 0.1, max: 2, noNaN: true, noDefaultInfinity: true })
              .map(normalizeZero),
          ),
          width: optional(posFloatArb),
          height: optional(posFloatArb),
          margin: optional(
            fc
              .record({
                top: optional(nonNegFloatArb),
                bottom: optional(nonNegFloatArb),
                left: optional(nonNegFloatArb),
                right: optional(nonNegFloatArb),
              })
              .map(omitUndefined),
          ),
          pageRanges: optional(edgeStringArb),
          headerTemplate: optional(edgeStringArb),
          footerTemplate: optional(edgeStringArb),
          preferCSSPageSize: optional(fc.boolean()),
          tagged: optional(fc.boolean()),
          outline: optional(fc.boolean()),
          timeout: optional(
            fc
              .double({ min: 0, max: 2_147_473_647, noNaN: true, noDefaultInfinity: true })
              .map(normalizeZero),
          ),
        })
        .map(omitUndefined),
    ),
  })
  .map(omitUndefined);

export const pageSnapshotParamsArb = fc
  .record({
    pageId: edgeStringArb,
    options: optional(
      fc
        .record({
          timeout: optional(nonNegFloatArb),
          includeIframes: optional(fc.boolean()),
        })
        .map(omitUndefined),
    ),
  })
  .map(omitUndefined);

export const pageSetViewportSizeParamsArb = fc
  .record({
    pageId: edgeStringArb,
    width: posIntArb,
    height: posIntArb,
    options: optional(fc.record({ deviceScaleFactor: optional(posFloatArb) }).map(omitUndefined)),
  })
  .map(omitUndefined);

export const pageWaitForFunctionParamsArb = fc
  .record({
    pageId: edgeStringArb,
    expression: edgeStringArb,
    options: optional(
      fc
        .record({
          polling: optional(
            fc.oneof(
              fc.constant("raf" as const),
              fc
                .double({ min: 0.1, max: 2_147_483_647, noNaN: true, noDefaultInfinity: true })
                .map(normalizeZero),
            ),
          ),
          timeout: optional(nonNegIntArb),
        })
        .map(omitUndefined),
    ),
  })
  .map(omitUndefined);

export const pageWaitForSelectorParamsArb = fc
  .record({
    pageId: edgeStringArb,
    selector: nonEmptyStringArb,
    options: optional(
      fc
        .record({
          state: optional(
            fc.constantFrom(
              "attached" as const,
              "detached" as const,
              "visible" as const,
              "hidden" as const,
            ),
          ),
          timeout: optional(nonNegIntArb),
          pierceShadow: optional(fc.boolean()),
        })
        .map(omitUndefined),
    ),
  })
  .map(omitUndefined);

export const pageTypeParamsArb = fc
  .record({
    pageId: edgeStringArb,
    text: edgeStringArb,
    options: optional(
      fc
        .record({
          delay: optional(nonNegFloatArb),
          withMistakes: optional(fc.boolean()),
        })
        .map(omitUndefined),
    ),
  })
  .map(omitUndefined);

export const pageSetExtraHTTPHeadersParamsArb = fc.record({
  pageId: edgeStringArb,
  headers: stringMapArb,
});

export const contextSetExtraHTTPHeadersParamsArb = fc.record({
  headers: stringMapArb,
});

const validCookieParamArb = fc.oneof(
  fc
    .record({
      name: edgeStringArb,
      value: edgeStringArb,
      url: httpUrlArb,
      expires: optional(fc.oneof(fc.constant(-1), nonNegFloatArb)),
      httpOnly: optional(fc.boolean()),
      secure: optional(fc.boolean()),
      sameSite: optional(fc.constantFrom("Strict" as const, "Lax" as const, "None" as const)),
    })
    .map((c) => {
      const isHttps = c.url.startsWith("https:");
      return omitUndefined({
        ...c,
        sameSite: c.sameSite === "None" && !isHttps ? ("Lax" as const) : c.sameSite,
      });
    }),
  fc
    .record({
      name: edgeStringArb,
      value: edgeStringArb,
      domain: nonEmptyStringArb,
      path: nonEmptyStringArb,
      expires: optional(fc.oneof(fc.constant(-1), nonNegFloatArb)),
      httpOnly: optional(fc.boolean()),
      secure: optional(fc.boolean()),
      sameSite: optional(fc.constantFrom("Strict" as const, "Lax" as const, "None" as const)),
    })
    .map((c) =>
      omitUndefined({
        ...c,
        secure: c.sameSite === "None" ? true : c.secure,
      }),
    ),
);

export const contextAddCookiesParamsArb = fc.record({
  cookies: fc.array(validCookieParamArb, { maxLength: 3 }),
});

const validCookieRegexArb = fc
  .record({
    source: fc.constantFrom("^session-", "[a-z0-9]+", "foo|bar", "plain", ""),
    flags: optional(fc.constantFrom("", "i", "g", "im", "su")),
  })
  .map(omitUndefined);

const cookieFilterArb = fc.oneof(edgeStringArb, validCookieRegexArb);

export const contextClearCookiesParamsArb = fc
  .record({
    options: optional(
      fc
        .record({
          name: optional(cookieFilterArb),
          domain: optional(cookieFilterArb),
          path: optional(cookieFilterArb),
        })
        .map(omitUndefined),
    ),
  })
  .map(omitUndefined);

export const contextClipboardPasteParamsArb = fc
  .record({
    pageId: optional(edgeStringArb),
    shortcut: optional(
      fc.constantFrom("ControlOrMeta+V" as const, "Meta+V" as const, "Control+V" as const),
    ),
  })
  .map(omitUndefined);

export const stagehandInitParamsArb = fc
  .record({
    protocolVersion: fc.constant(STAGEHAND_PROTOCOL_VERSION),
    clientInfo: fc.record({ name: nonEmptyStringArb, version: nonEmptyStringArb }),
    browserCdpUrl: optional(nonEmptyStringArb),
    useClientBrowserbase: fc.boolean(),
    sessionId: nonEmptyStringArb,
    region: optional(
      fc.constantFrom(
        "us-west-2" as const,
        "us-east-1" as const,
        "eu-central-1" as const,
        "ap-southeast-1" as const,
      ),
    ),
    model: optional(fc.oneof(modelConfigArb, fc.constant({ source: "client" as const }))),
    telemetry: optional(
      fc.record({
        traces: fc.record({
          endpoint: traceEndpointUrlArb,
          headers: stringMapArb,
        }),
      }),
    ),
    logLevel: fc.constantFrom(
      "off" as const,
      "error" as const,
      "warn" as const,
      "info" as const,
      "debug" as const,
    ),
    systemPrompt: optional(edgeStringArb),
    selfHeal: optional(fc.boolean()),
    domSettleTimeoutMs: optional(posIntArb),
    cache: optional(cachingArb),
  })
  .map((raw) =>
    omitUndefined({
      protocolVersion: raw.protocolVersion,
      clientInfo: raw.clientInfo,
      browserCdpUrl: raw.browserCdpUrl,
      browserbase: raw.useClientBrowserbase ? ("client" as const) : undefined,
      browser: raw.useClientBrowserbase
        ? omitUndefined({ sessionId: raw.sessionId, region: raw.region })
        : undefined,
      model: raw.model,
      telemetry: raw.telemetry,
      logLevel: raw.logLevel,
      systemPrompt: raw.systemPrompt,
      selfHeal: raw.selfHeal,
      domSettleTimeoutMs: raw.domSettleTimeoutMs,
      cache: raw.cache,
    }),
  );

export const stagehandActParamsArb = fc
  .record({
    pageId: nonEmptyStringArb,
    instruction: fc.oneof(nonEmptyStringArb, actionArb),
    options: optional(
      fc
        .record({
          model: optional(modelConfigArb),
          variables: optional(variablesArb),
          timeout: optional(finiteFloatArb),
          locator: optional(locatorInputArb),
          ignoreLocators: optional(fc.array(locatorInputArb, { maxLength: 2 })),
          cache: optional(cachingArb),
        })
        .map(omitUndefined),
    ),
  })
  .map(omitUndefined);

export const stagehandObserveParamsArb = fc
  .record({
    pageId: nonEmptyStringArb,
    instruction: optional(edgeStringArb),
    options: optional(
      fc
        .record({
          model: optional(modelConfigArb),
          variables: optional(variablesArb),
          timeout: optional(finiteFloatArb),
          locator: optional(locatorInputArb),
          ignoreLocators: optional(fc.array(locatorInputArb, { maxLength: 2 })),
          cache: optional(cachingArb),
        })
        .map(omitUndefined),
    ),
  })
  .map(omitUndefined);

export const stagehandExtractParamsArb = fc
  .record({
    pageId: nonEmptyStringArb,
    instruction: nonEmptyStringArb,
    schema: jsonObjectArb,
    options: optional(
      fc
        .record({
          model: optional(modelConfigArb),
          timeout: optional(finiteFloatArb),
          locator: optional(locatorInputArb),
          ignoreLocators: optional(fc.array(locatorInputArb, { maxLength: 2 })),
          screenshot: optional(fc.boolean()),
          cache: optional(cachingArb),
        })
        .map(omitUndefined),
    ),
  })
  .map(omitUndefined);

export const browserbaseRequestParamsArb = fc
  .record({
    operation: fc.constantFrom(
      "gateway.responses" as const,
      "cache.get" as const,
      "cache.set" as const,
    ),
    headers: stringMapArb,
    body: edgeStringArb,
    remainingTimeoutMs: optional(nonNegFloatArb),
  })
  .map(omitUndefined);

export const browserbaseRequestResultArb = fc.oneof(
  fc.record({
    type: fc.constant("response" as const),
    status: fc.integer({ min: 200, max: 599 }),
    statusText: edgeStringArb,
    headers: stringMapArb,
    body: edgeStringArb,
  }),
  fc.record({
    type: fc.constant("error" as const),
    reason: fc.constantFrom(
      "network" as const,
      "cancelled" as const,
      "timeout" as const,
      "unavailable" as const,
      "disconnected" as const,
    ),
    message: edgeStringArb,
  }),
);

export const browserbaseCancelParamsArb = fc.record({
  requestId: requestIdArb,
  reason: fc.constantFrom("cancelled" as const, "timeout" as const),
});

const webMCPToolDescriptorArb = fc
  .record({
    toolId: optional(nonEmptyStringArb),
    name: nonEmptyStringArb,
    description: edgeStringArb,
    inputSchema: optional(jsonObjectArb),
    annotations: optional(
      fc
        .record({
          readOnly: optional(fc.boolean()),
          untrustedContent: optional(fc.boolean()),
          autosubmit: optional(fc.boolean()),
        })
        .map(omitUndefined),
    ),
    frameId: nonEmptyStringArb,
    backendNodeId: optional(nonNegIntArb),
  })
  .map(omitUndefined);

export const pageEventNotificationArb = fc.oneof(
  fc.record({
    subscriptionId: nonEmptyStringArb,
    pageId: nonEmptyStringArb,
    sessionId: nonEmptyStringArb,
    targetId: nonEmptyStringArb,
    event: fc.constant("toolsadded" as const),
    tools: fc.array(webMCPToolDescriptorArb, { maxLength: 2 }),
  }),
  fc.record({
    subscriptionId: nonEmptyStringArb,
    pageId: nonEmptyStringArb,
    sessionId: nonEmptyStringArb,
    targetId: nonEmptyStringArb,
    event: fc.constant("toolsremoved" as const),
    tools: fc.array(
      fc
        .record({
          toolId: optional(nonEmptyStringArb),
          frameId: nonEmptyStringArb,
          name: nonEmptyStringArb,
        })
        .map(omitUndefined),
      { maxLength: 2 },
    ),
  }),
  fc.record({
    subscriptionId: nonEmptyStringArb,
    pageId: nonEmptyStringArb,
    sessionId: nonEmptyStringArb,
    targetId: nonEmptyStringArb,
    event: fc.constant("response" as const),
    response: fc.record({
      responseId: nonEmptyStringArb,
      url: edgeStringArb,
      status: nonNegIntArb,
      statusText: edgeStringArb,
      headers: stringMapArb,
      fromServiceWorker: fc.boolean(),
    }),
  }),
);

export const pageCDPEventNotificationArb = fc.record({
  subscriptionId: nonEmptyStringArb,
  event: fc.record({
    pageId: nonEmptyStringArb,
    method: fc.constant("Runtime.consoleAPICalled" as const),
    params: jsonObjectArb,
    sessionId: nonEmptyStringArb,
    targetId: nonEmptyStringArb,
  }),
});

export const stagehandLogArb = fc.record({
  level: fc.constantFrom("debug" as const, "info" as const, "warn" as const, "error" as const),
  message: nonEmptyStringArb,
  data: jsonObjectArb,
});

const llmRoleArb = fc.constantFrom("user" as const, "assistant" as const);
const llmAnnotationsArb = fc
  .record({
    audience: optional(fc.array(llmRoleArb, { maxLength: 2 })),
    priority: optional(
      fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }).map(normalizeZero),
    ),
    lastModified: optional(edgeStringArb),
  })
  .map(omitUndefined);

const llmTextContentArb = fc
  .record({
    type: fc.constant("text" as const),
    text: edgeStringArb,
    annotations: optional(llmAnnotationsArb),
  })
  .map(omitUndefined);

const llmImageContentArb = fc
  .record({
    type: fc.constant("image" as const),
    data: base64Arb,
    mimeType: edgeStringArb,
    annotations: optional(llmAnnotationsArb),
  })
  .map(omitUndefined);

const llmContentBlockArb = fc.oneof(
  llmTextContentArb,
  llmImageContentArb,
  fc.record({
    type: fc.constant("tool_use" as const),
    id: edgeStringArb,
    name: edgeStringArb,
    input: jsonObjectArb,
  }),
  fc
    .record({
      type: fc.constant("tool_result" as const),
      toolUseId: edgeStringArb,
      content: fc.array(fc.oneof(llmTextContentArb, llmImageContentArb), { maxLength: 2 }),
      structuredContent: optional(jsonObjectArb),
      isError: optional(fc.boolean()),
    })
    .map(omitUndefined),
);

const llmMessageArb = fc.record({
  role: llmRoleArb,
  content: fc.oneof(llmContentBlockArb, fc.array(llmContentBlockArb, { maxLength: 2 })),
});

export const llmGenerateParamsArb = fc.oneof(
  fc
    .record({
      messages: fc.array(llmMessageArb, { maxLength: 2 }),
      systemPrompt: optional(edgeStringArb),
      temperature: optional(finiteFloatArb),
      stopSequences: optional(fc.array(edgeStringArb, { maxLength: 3 })),
      responseFormat: fc
        .record({
          type: fc.constant("json_schema" as const),
          name: edgeStringArb,
          description: optional(edgeStringArb),
          schema: jsonObjectArb,
        })
        .map(omitUndefined),
    })
    .map(omitUndefined),
  fc
    .record({
      messages: fc.array(llmMessageArb, { maxLength: 2 }),
      systemPrompt: optional(edgeStringArb),
      temperature: optional(finiteFloatArb),
      stopSequences: optional(fc.array(edgeStringArb, { maxLength: 3 })),
      toolChoice: optional(
        fc
          .record({
            mode: optional(fc.constantFrom("auto" as const, "required" as const, "none" as const)),
          })
          .map(omitUndefined),
      ),
      responseFormat: optional(fc.constant({ type: "text" as const })),
    })
    .map(omitUndefined),
);

const llmUsageArb = fc
  .record({
    inputTokens: nonNegIntArb,
    outputTokens: nonNegIntArb,
    totalTokens: nonNegIntArb,
    reasoningTokens: optional(nonNegIntArb),
    cachedInputTokens: optional(nonNegIntArb),
  })
  .map(omitUndefined);

export const llmGenerateResultArb = fc.oneof(
  fc
    .record({
      role: llmRoleArb,
      content: fc.oneof(llmContentBlockArb, fc.array(llmContentBlockArb, { maxLength: 2 })),
      stopReason: optional(edgeStringArb),
      usage: optional(llmUsageArb),
      outputFormat: fc.constant("text" as const),
    })
    .map(omitUndefined),
  fc
    .record({
      role: llmRoleArb,
      content: fc.oneof(llmContentBlockArb, fc.array(llmContentBlockArb, { maxLength: 2 })),
      stopReason: optional(edgeStringArb),
      usage: optional(llmUsageArb),
      outputFormat: fc.constant("json_schema" as const),
      structuredContent: jsonValueArb,
    })
    .map(omitUndefined),
);

export const llmGenerateResultWithToolUseArb = fc
  .record({
    role: llmRoleArb,
    content: fc.record({
      type: fc.constant("tool_use" as const),
      id: edgeStringArb,
      name: edgeStringArb,
      input: fc.dictionary(
        fc.oneof(fc.constantFrom("camelArg", "snake_arg", "FOO_BAR", " "), edgeKeyArb),
        jsonValueArb,
        { minKeys: 1, maxKeys: 4 },
      ),
    }),
    outputFormat: fc.constant("text" as const),
  })
  .map(omitUndefined);

export const pageWebMCPToolsResultArb = fc.record({
  tools: fc.array(webMCPToolDescriptorArb, { maxLength: 3 }),
});

export const pageWebMCPInvokeToolParamsArb = fc
  .record({
    pageId: edgeStringArb,
    frameId: nonEmptyStringArb,
    toolName: nonEmptyStringArb,
    toolId: optional(nonEmptyStringArb),
    input: jsonObjectArb,
  })
  .map(omitUndefined);

export const webMCPToolResponseArb = fc
  .record({
    invocationId: nonEmptyStringArb,
    status: fc.constantFrom("Completed" as const, "Canceled" as const, "Error" as const),
    output: optional(jsonValueArb),
    errorText: optional(edgeStringArb),
    exception: optional(jsonObjectArb),
  })
  .map(omitUndefined);

const jsonRpcParamsArb = fc.oneof(jsonObjectArb, fc.array(jsonValueArb, { maxLength: 4 }));

export const jsonRpcRequestArb = fc
  .record({
    jsonrpc: fc.constant("2.0" as const),
    id: requestIdArb,
    method: edgeStringArb,
    params: optional(jsonRpcParamsArb),
    traceparent: optional(edgeStringArb),
    tracestate: optional(edgeStringArb),
  })
  .map(omitUndefined);

export const jsonRpcNotificationArb = fc
  .record({
    jsonrpc: fc.constant("2.0" as const),
    method: edgeStringArb,
    params: optional(jsonRpcParamsArb),
  })
  .map(omitUndefined);

export const jsonRpcSuccessResponseArb = fc.record({
  jsonrpc: fc.constant("2.0" as const),
  id: requestIdArb,
  result: jsonValueArb,
});

export const jsonRpcErrorResponseArb = fc.record({
  jsonrpc: fc.constant("2.0" as const),
  id: fc.option(requestIdArb, { nil: null }),
  error: fc
    .record({
      code: safeIntArb,
      message: edgeStringArb,
      data: optional(jsonValueArb),
    })
    .map(omitUndefined),
});

export function buildWireOptionsBySchema(): ReadonlyMap<z.ZodType, WireCasingOptions> {
  const wireBySchema = new Map<z.ZodType, WireCasingOptions>();
  for (const method of Object.values(StagehandMethods)) {
    if ("paramsWire" in method && method.paramsWire) {
      wireBySchema.set(method.params, method.paramsWire);
    }
    if ("resultWire" in method && method.resultWire) {
      wireBySchema.set(method.result, method.resultWire);
    }
  }
  for (const notification of Object.values(StagehandNotifications)) {
    if ("paramsWire" in notification && notification.paramsWire) {
      wireBySchema.set(notification.params, notification.paramsWire);
    }
  }
  return wireBySchema;
}

export const WIRE_BY_SCHEMA = buildWireOptionsBySchema();

export type ProtocolTestCase = {
  readonly name: string;
  readonly pythonModel: string;
  readonly schema: z.ZodType;
  readonly arb: fc.Arbitrary<unknown>;
  readonly wire?: WireCasingOptions;
};

export const PROTOCOL_CASES: readonly ProtocolTestCase[] = [
  {
    name: "LocatorChain",
    pythonModel: "LocatorChain",
    schema: LocatorChainSchema,
    arb: locatorChainArb,
  },
  {
    name: "LocatorInput",
    pythonModel: "LocatorInput",
    schema: LocatorInputSchema,
    arb: locatorInputArb,
  },
  {
    name: "LocatorRequestDescriptor",
    pythonModel: "LocatorRequestDescriptor",
    schema: LocatorRequestDescriptorSchema,
    arb: locatorRequestDescriptorArb,
  },
  {
    name: "LocatorParams",
    pythonModel: "LocatorParams",
    schema: LocatorParamsSchema,
    arb: locatorParamsArb,
  },
  {
    name: "LocatorClickParams",
    pythonModel: "LocatorClickParams",
    schema: LocatorClickParamsSchema,
    arb: locatorClickParamsArb,
  },
  {
    name: "LocatorHighlightParams",
    pythonModel: "LocatorHighlightParams",
    schema: LocatorHighlightParamsSchema,
    arb: locatorHighlightParamsArb,
  },
  {
    name: "LocatorSetInputFilesParams",
    pythonModel: "LocatorSetInputFilesParams",
    schema: LocatorSetInputFilesParamsSchema,
    arb: locatorSetInputFilesParamsArb,
  },
  {
    name: "DomainPolicy",
    pythonModel: "DomainPolicy",
    schema: DomainPolicySchema,
    arb: domainPolicyArb,
  },
  {
    name: "ContextSetDomainPolicyParams",
    pythonModel: "ContextSetDomainPolicyParams",
    schema: ContextSetDomainPolicyParamsSchema,
    arb: contextSetDomainPolicyParamsArb,
  },
  {
    name: "ContextGetDomainPolicyResult",
    pythonModel: "ContextGetDomainPolicyResult",
    schema: ContextGetDomainPolicyResultSchema,
    arb: contextGetDomainPolicyResultArb,
  },
  {
    name: "StagehandResultUsage",
    pythonModel: "StagehandResultUsage",
    schema: StagehandResultUsageSchema,
    arb: stagehandResultUsageArb,
  },
  {
    name: "CacheMetadata",
    pythonModel: "CacheMetadata",
    schema: CacheMetadataSchema,
    arb: cacheMetadataArb,
  },
  {
    name: "StagehandResultMetadata",
    pythonModel: "StagehandResultMetadata",
    schema: StagehandResultMetadataSchema,
    arb: stagehandResultMetadataArb,
  },
  {
    name: "ActResult",
    pythonModel: "ActResult",
    schema: ActResultSchema,
    arb: actResultArb,
  },
  {
    name: "ObserveResult",
    pythonModel: "ObserveResult",
    schema: ObserveResultSchema,
    arb: observeResultArb,
  },
  {
    name: "ExtractResult",
    pythonModel: "ExtractResult",
    schema: ExtractResultSchema,
    arb: extractResultArb,
  },
  {
    name: "CallbackBatchOptions",
    pythonModel: "CallbackBatchOptions",
    schema: CallbackBatchOptionsSchema,
    arb: callbackBatchOptionsArb,
  },
  {
    name: "CallbackBatchParams",
    pythonModel: "CallbackBatchParams",
    schema: CallbackBatchParamsSchema,
    arb: callbackBatchParamsArb,
  },
  {
    name: "CallbackBatchResult",
    pythonModel: "CallbackBatchResult",
    schema: CallbackBatchResultSchema,
    arb: callbackBatchResultArb,
  },
  {
    name: "PageGotoParams",
    pythonModel: "PageGotoParams",
    schema: PageGotoParamsSchema,
    arb: pageGotoParamsArb,
  },
  {
    name: "PageClickParams",
    pythonModel: "PageClickParams",
    schema: PageClickParamsSchema,
    arb: pageClickParamsArb,
  },
  {
    name: "PageDragAndDropParams",
    pythonModel: "PageDragAndDropParams",
    schema: PageDragAndDropParamsSchema,
    arb: pageDragAndDropParamsArb,
  },
  {
    name: "PageScreenshotParams",
    pythonModel: "PageScreenshotParams",
    schema: PageScreenshotParamsSchema,
    arb: pageScreenshotParamsArb,
  },
  {
    name: "PagePDFParams",
    pythonModel: "PagePDFParams",
    schema: PagePDFParamsSchema,
    arb: pagePDFParamsArb,
  },
  {
    name: "PageSnapshotParams",
    pythonModel: "PageSnapshotParams",
    schema: PageSnapshotParamsSchema,
    arb: pageSnapshotParamsArb,
  },
  {
    name: "PageSetViewportSizeParams",
    pythonModel: "PageSetViewportSizeParams",
    schema: PageSetViewportSizeParamsSchema,
    arb: pageSetViewportSizeParamsArb,
  },
  {
    name: "PageWaitForFunctionParams",
    pythonModel: "PageWaitForFunctionParams",
    schema: PageWaitForFunctionParamsSchema,
    arb: pageWaitForFunctionParamsArb,
  },
  {
    name: "PageWaitForSelectorParams",
    pythonModel: "PageWaitForSelectorParams",
    schema: PageWaitForSelectorParamsSchema,
    arb: pageWaitForSelectorParamsArb,
  },
  {
    name: "PageTypeParams",
    pythonModel: "PageTypeParams",
    schema: PageTypeParamsSchema,
    arb: pageTypeParamsArb,
  },
  {
    name: "PageSetExtraHTTPHeadersParams",
    pythonModel: "PageSetExtraHTTPHeadersParams",
    schema: PageSetExtraHTTPHeadersParamsSchema,
    arb: pageSetExtraHTTPHeadersParamsArb,
  },
  {
    name: "ContextSetExtraHTTPHeadersParams",
    pythonModel: "ContextSetExtraHTTPHeadersParams",
    schema: ContextSetExtraHTTPHeadersParamsSchema,
    arb: contextSetExtraHTTPHeadersParamsArb,
  },
  {
    name: "ContextAddCookiesParams",
    pythonModel: "ContextAddCookiesParams",
    schema: ContextAddCookiesParamsSchema,
    arb: contextAddCookiesParamsArb,
  },
  {
    name: "ContextClearCookiesParams",
    pythonModel: "ContextClearCookiesParams",
    schema: ContextClearCookiesParamsSchema,
    arb: contextClearCookiesParamsArb,
  },
  {
    name: "ContextClipboardPasteParams",
    pythonModel: "ContextClipboardPasteParams",
    schema: ContextClipboardPasteParamsSchema,
    arb: contextClipboardPasteParamsArb,
  },
  {
    name: "StagehandInitParams",
    pythonModel: "StagehandInitParams",
    schema: StagehandInitParamsSchema,
    arb: stagehandInitParamsArb,
  },
  {
    name: "StagehandActParams",
    pythonModel: "StagehandActParams",
    schema: StagehandActParamsSchema,
    arb: stagehandActParamsArb,
  },
  {
    name: "StagehandObserveParams",
    pythonModel: "StagehandObserveParams",
    schema: StagehandObserveParamsSchema,
    arb: stagehandObserveParamsArb,
  },
  {
    name: "StagehandExtractParams",
    pythonModel: "StagehandExtractParams",
    schema: StagehandExtractParamsSchema,
    arb: stagehandExtractParamsArb,
  },
  {
    name: "BrowserbaseRequestParams",
    pythonModel: "BrowserbaseRequestParams",
    schema: BrowserbaseRequestParamsSchema,
    arb: browserbaseRequestParamsArb,
  },
  {
    name: "BrowserbaseRequestResult",
    pythonModel: "BrowserbaseRequestResult",
    schema: BrowserbaseRequestResultSchema,
    arb: browserbaseRequestResultArb,
  },
  {
    name: "BrowserbaseCancelParams",
    pythonModel: "BrowserbaseCancelParams",
    schema: BrowserbaseCancelParamsSchema,
    arb: browserbaseCancelParamsArb,
  },
  {
    name: "PageEventNotification",
    pythonModel: "PageEventNotification",
    schema: PageEventNotificationSchema,
    arb: pageEventNotificationArb,
  },
  {
    name: "PageCDPEventNotification",
    pythonModel: "PageCDPEventNotification",
    schema: PageCDPEventNotificationSchema,
    arb: pageCDPEventNotificationArb,
  },
  {
    name: "StagehandLog",
    pythonModel: "StagehandLog",
    schema: StagehandLogSchema,
    arb: stagehandLogArb,
  },
  {
    name: "LLMGenerateParams",
    pythonModel: "LLMGenerateParams",
    schema: LLMGenerateParamsSchema,
    arb: llmGenerateParamsArb,
  },
  {
    name: "LLMGenerateResult",
    pythonModel: "LLMGenerateResult",
    schema: LLMGenerateResultSchema,
    arb: llmGenerateResultArb,
  },
  {
    name: "PageWebMCPToolsResult",
    pythonModel: "PageWebMCPToolsResult",
    schema: PageWebMCPToolsResultSchema,
    arb: pageWebMCPToolsResultArb,
  },
  {
    name: "PageWebMCPInvokeToolParams",
    pythonModel: "PageWebMCPInvokeToolParams",
    schema: PageWebMCPInvokeToolParamsSchema,
    arb: pageWebMCPInvokeToolParamsArb,
  },
  {
    name: "WebMCPToolResponse",
    pythonModel: "WebMCPToolResponse",
    schema: WebMCPToolResponseSchema,
    arb: webMCPToolResponseArb,
  },
].map((entry) => ({
  ...entry,
  wire: WIRE_BY_SCHEMA.get(entry.schema),
}));

export const ENVELOPE_CASES: readonly ProtocolTestCase[] = [
  {
    name: "JSONRPCRequest",
    pythonModel: "_JSONRPCRequest",
    schema: JSONRPCRequestSchema,
    arb: jsonRpcRequestArb,
  },
  {
    name: "JSONRPCNotification",
    pythonModel: "_JSONRPCNotification",
    schema: JSONRPCNotificationSchema,
    arb: jsonRpcNotificationArb,
  },
  {
    name: "JSONRPCSuccessResponse",
    pythonModel: "_JSONRPCSuccessResponse",
    schema: JSONRPCSuccessResponseSchema,
    arb: jsonRpcSuccessResponseArb,
  },
  {
    name: "JSONRPCErrorResponse",
    pythonModel: "_JSONRPCErrorResponse",
    schema: JSONRPCErrorResponseSchema,
    arb: jsonRpcErrorResponseArb,
  },
];

export function findStructuralMismatch(
  actual: unknown,
  expected: unknown,
  pathLabel = "$",
): string | null {
  if (Object.is(actual, expected)) return null;
  if (typeof actual !== typeof expected || actual === null || expected === null) {
    return `mismatch at ${pathLabel}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`;
  }
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) {
      return `array mismatch at ${pathLabel}`;
    }
    if (actual.length !== expected.length) {
      return `array length mismatch at ${pathLabel}: actual=${actual.length} expected=${expected.length}`;
    }
    for (let i = 0; i < expected.length; i++) {
      const mismatch = findStructuralMismatch(actual[i], expected[i], `${pathLabel}[${i}]`);
      if (mismatch !== null) return mismatch;
    }
    return null;
  }
  if (typeof actual === "object" && typeof expected === "object") {
    const aObj = actual as Record<string, unknown>;
    const eObj = expected as Record<string, unknown>;
    const aKeys = Object.keys(aObj).sort();
    const eKeys = Object.keys(eObj).sort();
    if (aKeys.length !== eKeys.length || aKeys.some((key, index) => key !== eKeys[index])) {
      return `keys mismatch at ${pathLabel}: actual=${JSON.stringify(aKeys)} expected=${JSON.stringify(eKeys)}`;
    }
    for (const key of eKeys) {
      const mismatch = findStructuralMismatch(aObj[key], eObj[key], `${pathLabel}.${key}`);
      if (mismatch !== null) return mismatch;
    }
    return null;
  }
  return `value mismatch at ${pathLabel}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`;
}
