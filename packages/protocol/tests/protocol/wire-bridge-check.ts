import { createInterface } from "node:readline";
import fc from "fast-check";
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
  StagehandNotifications,
  StagehandRpcNotificationSchema,
  StagehandRpcRequestSchema,
  getStagehandMethod,
} from "../../schema-registry.js";
import {
  ActionSchema,
  ActOptionsSchema,
  ActResultSchema,
  BrowserbaseCancelParamsSchema,
  BrowserbaseRequestParamsSchema,
  BrowserbaseRequestResultSchema,
  CacheMetadataSchema,
  CallbackBatchOptionsSchema,
  CallbackBatchParamsSchema,
  CallbackBatchResultSchema,
  ClearCookieOptionsSchema,
  ContextAddCookiesParamsSchema,
  ContextClearCookiesParamsSchema,
  ContextClipboardPasteParamsSchema,
  ContextGetDomainPolicyResultSchema,
  ContextSetDomainPolicyParamsSchema,
  ContextSetExtraHTTPHeadersParamsSchema,
  CookieParamSchema,
  CookieRegexSchema,
  CookieSchema,
  DomainPolicySchema,
  ExtractResultSchema,
  InputFilePayloadSchema,
  LLMGenerateParamsSchema,
  LLMGenerateResultSchema,
  LocatorChainSchema,
  LocatorClickParamsSchema,
  LocatorHighlightParamsSchema,
  LocatorInputSchema,
  LocatorParamsSchema,
  LocatorRequestDescriptorSchema,
  LocatorSetInputFilesParamsSchema,
  ObserveResultSchema,
  PageCDPEventNotificationSchema,
  PageClickParamsSchema,
  PageDragAndDropParamsSchema,
  PageEventNotificationSchema,
  PageGotoParamsSchema,
  PagePDFParamsSchema,
  PageScreenshotOptionsSchema,
  PageScreenshotParamsSchema,
  PageSetExtraHTTPHeadersParamsSchema,
  PageSetViewportSizeParamsSchema,
  PageSnapshotParamsSchema,
  PageTypeParamsSchema,
  PageWaitForFunctionParamsSchema,
  PageWaitForSelectorParamsSchema,
  PageWebMCPInvokeToolParamsSchema,
  PageWebMCPToolsResultSchema,
  StagehandActParamsSchema,
  StagehandExtractParamsSchema,
  StagehandInitParamsSchema,
  StagehandLogSchema,
  StagehandObserveParamsSchema,
  StagehandResultMetadataSchema,
  StagehandResultUsageSchema,
  TelemetryConfigSchema,
  WebMCPToolResponseSchema,
} from "../../schemas.js";
import {
  ENVELOPE_CASES,
  findStructuralMismatch,
  PROTOCOL_CASES,
  WIRE_BY_SCHEMA,
} from "./wire-roundtrip-fixtures.js";

type SchemaEntry = {
  schema: z.ZodType;
  wire?: WireCasingOptions;
  isEnvelope?: boolean;
};

const RAW_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  Action: ActionSchema,
  ActOptions: ActOptionsSchema,
  ActResult: ActResultSchema,
  BrowserbaseCancelParams: BrowserbaseCancelParamsSchema,
  BrowserbaseRequestParams: BrowserbaseRequestParamsSchema,
  BrowserbaseRequestResult: BrowserbaseRequestResultSchema,
  CacheMetadata: CacheMetadataSchema,
  CallbackBatchOptions: CallbackBatchOptionsSchema,
  CallbackBatchParams: CallbackBatchParamsSchema,
  CallbackBatchResult: CallbackBatchResultSchema,
  ClearCookieOptions: ClearCookieOptionsSchema,
  ContextAddCookiesParams: ContextAddCookiesParamsSchema,
  ContextClearCookiesParams: ContextClearCookiesParamsSchema,
  ContextClipboardPasteParams: ContextClipboardPasteParamsSchema,
  ContextGetDomainPolicyResult: ContextGetDomainPolicyResultSchema,
  ContextSetDomainPolicyParams: ContextSetDomainPolicyParamsSchema,
  ContextSetExtraHTTPHeadersParams: ContextSetExtraHTTPHeadersParamsSchema,
  Cookie: CookieSchema,
  CookieParam: CookieParamSchema,
  CookieRegex: CookieRegexSchema,
  DomainPolicy: DomainPolicySchema,
  ExtractResult: ExtractResultSchema,
  InputFilePayload: InputFilePayloadSchema,
  LLMGenerateParams: LLMGenerateParamsSchema,
  LLMGenerateResult: LLMGenerateResultSchema,
  LocatorChain: LocatorChainSchema,
  LocatorClickParams: LocatorClickParamsSchema,
  LocatorHighlightParams: LocatorHighlightParamsSchema,
  LocatorInput: LocatorInputSchema,
  LocatorParams: LocatorParamsSchema,
  LocatorRequestDescriptor: LocatorRequestDescriptorSchema,
  LocatorSetInputFilesParams: LocatorSetInputFilesParamsSchema,
  ObserveResult: ObserveResultSchema,
  PageCDPEventNotification: PageCDPEventNotificationSchema,
  PageClickParams: PageClickParamsSchema,
  PageDragAndDropParams: PageDragAndDropParamsSchema,
  PageEventNotification: PageEventNotificationSchema,
  PageGotoParams: PageGotoParamsSchema,
  PagePDFParams: PagePDFParamsSchema,
  PageScreenshotOptions: PageScreenshotOptionsSchema,
  PageScreenshotParams: PageScreenshotParamsSchema,
  PageSetExtraHTTPHeadersParams: PageSetExtraHTTPHeadersParamsSchema,
  PageSetViewportSizeParams: PageSetViewportSizeParamsSchema,
  PageSnapshotParams: PageSnapshotParamsSchema,
  PageTypeParams: PageTypeParamsSchema,
  PageWaitForFunctionParams: PageWaitForFunctionParamsSchema,
  PageWaitForSelectorParams: PageWaitForSelectorParamsSchema,
  PageWebMCPInvokeToolParams: PageWebMCPInvokeToolParamsSchema,
  PageWebMCPToolsResult: PageWebMCPToolsResultSchema,
  StagehandActParams: StagehandActParamsSchema,
  StagehandExtractParams: StagehandExtractParamsSchema,
  StagehandInitParams: StagehandInitParamsSchema,
  StagehandLog: StagehandLogSchema,
  StagehandObserveParams: StagehandObserveParamsSchema,
  StagehandResultMetadata: StagehandResultMetadataSchema,
  StagehandResultUsage: StagehandResultUsageSchema,
  TelemetryConfig: TelemetryConfigSchema,
  WebMCPToolResponse: WebMCPToolResponseSchema,
};

const ENVELOPE_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  JSONRPCRequest: JSONRPCRequestSchema,
  JSONRPCNotification: JSONRPCNotificationSchema,
  JSONRPCSuccessResponse: JSONRPCSuccessResponseSchema,
  JSONRPCErrorResponse: JSONRPCErrorResponseSchema,
  JSONRPCResponse: JSONRPCResponseSchema,
  JSONRPCMessage: JSONRPCMessageSchema,
  StagehandRpcRequest: StagehandRpcRequestSchema,
  StagehandRpcNotification: StagehandRpcNotificationSchema,
};

const SCHEMA_MAP: Readonly<Record<string, SchemaEntry>> = {
  ...Object.fromEntries(
    Object.entries(RAW_SCHEMAS).map(([name, schema]) => [
      name,
      { schema, wire: WIRE_BY_SCHEMA.get(schema) },
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(ENVELOPE_SCHEMAS).map(([name, schema]) => [name, { schema, isEnvelope: true }]),
  ),
};

type ValidateBridgeInput = {
  op?: "validate";
  schema: string;
  rawJson?: string;
  payload?: unknown;
};

type SampleProtocolCasesInput = {
  op: "sample_protocol_cases";
  samplesPerSchema: number;
  seed: number;
};

type SampleEnvelopeCasesInput = {
  op: "sample_envelope_cases";
  samplesPerEnvelope: number;
  seed: number;
};

type VerifyRoundtripInput = {
  op: "verify_roundtrip";
  schema: string;
  expectedWireJson: string;
  actualWireJson: string;
};

type BridgeInput =
  | ValidateBridgeInput
  | SampleProtocolCasesInput
  | SampleEnvelopeCasesInput
  | VerifyRoundtripInput;

type BridgeOutput =
  | {
      ok: true;
      wire?: unknown;
      samples?: Array<{ name: string; pythonModel: string; rawJson: string }>;
    }
  | { ok: false; error: string };

function validatePayload(input: ValidateBridgeInput): BridgeOutput {
  const entry = SCHEMA_MAP[input.schema];
  if (!entry) {
    return { ok: false, error: `Unknown TS protocol schema: ${input.schema}` };
  }

  let parsedRaw: unknown;
  try {
    parsedRaw = input.rawJson !== undefined ? JSON.parse(input.rawJson) : input.payload;
  } catch (error) {
    return {
      ok: false,
      error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (entry.isEnvelope) {
    const result = entry.schema.safeParse(parsedRaw);
    if (!result.success) {
      return { ok: false, error: z.prettifyError(result.error) };
    }
    if (input.schema === "StagehandRpcRequest") {
      const req = result.data as { method: string; params: unknown; [key: string]: unknown };
      const method = getStagehandMethod(req.method);
      return {
        ok: true,
        wire: {
          ...req,
          params: encodeWireValue(req.params, method?.paramsWire),
        },
      };
    }
    if (input.schema === "StagehandRpcNotification") {
      const notif = result.data as { method: string; params: unknown; [key: string]: unknown };
      const registered = Object.values(StagehandNotifications).find((n) => n.name === notif.method);
      return {
        ok: true,
        wire: {
          ...notif,
          params: encodeWireValue(notif.params, registered?.paramsWire),
        },
      };
    }
    return { ok: true, wire: result.data };
  }

  const validator = wireSchema(entry.schema, entry.wire);
  const result = validator.safeParse(parsedRaw);
  if (!result.success) {
    return { ok: false, error: z.prettifyError(result.error) };
  }

  return {
    ok: true,
    wire: encodeWireValue(result.data, entry.wire),
  };
}

function sampleProtocolCases(samplesPerSchema: number, seed: number): BridgeOutput {
  const samples: Array<{ name: string; pythonModel: string; rawJson: string }> = [];
  for (const entry of PROTOCOL_CASES) {
    const generated = fc.sample(entry.arb, { numRuns: samplesPerSchema, seed });
    for (const sample of generated) {
      const parsedApi = entry.schema.parse(sample);
      const tsWire = encodeWireValue(parsedApi, entry.wire);
      samples.push({
        name: entry.name,
        pythonModel: entry.pythonModel,
        rawJson: JSON.stringify(tsWire),
      });
    }
  }
  return { ok: true, samples };
}

function sampleEnvelopeCases(samplesPerEnvelope: number, seed: number): BridgeOutput {
  const samples: Array<{ name: string; pythonModel: string; rawJson: string }> = [];
  for (const entry of ENVELOPE_CASES) {
    const generated = fc.sample(entry.arb, { numRuns: samplesPerEnvelope, seed });
    for (const sample of generated) {
      const parsed = entry.schema.parse(sample);
      samples.push({
        name: entry.name,
        pythonModel: entry.pythonModel,
        rawJson: JSON.stringify(parsed),
      });
    }
  }
  return { ok: true, samples };
}

function verifyRoundtrip(input: VerifyRoundtripInput): BridgeOutput {
  const entry = SCHEMA_MAP[input.schema];
  if (!entry) {
    return { ok: false, error: `Unknown TS protocol schema: ${input.schema}` };
  }
  const validator = entry.isEnvelope ? entry.schema : wireSchema(entry.schema, entry.wire);
  const expectedResult = validator.safeParse(JSON.parse(input.expectedWireJson));
  if (!expectedResult.success) {
    return {
      ok: false,
      error: `Expected wire failed parse: ${z.prettifyError(expectedResult.error)}`,
    };
  }
  const actualResult = validator.safeParse(JSON.parse(input.actualWireJson));
  if (!actualResult.success) {
    return { ok: false, error: `Actual wire failed parse: ${z.prettifyError(actualResult.error)}` };
  }
  const mismatch = findStructuralMismatch(
    actualResult.data,
    expectedResult.data,
    `TS->Python->TS(${input.schema})`,
  );
  if (mismatch !== null) {
    return { ok: false, error: mismatch };
  }
  return { ok: true };
}

function processInput(input: BridgeInput): BridgeOutput {
  switch (input.op) {
    case undefined:
    case "validate":
      return validatePayload(input);
    case "sample_protocol_cases":
      return sampleProtocolCases(input.samplesPerSchema, input.seed);
    case "sample_envelope_cases":
      return sampleEnvelopeCases(input.samplesPerEnvelope, input.seed);
    case "verify_roundtrip":
      return verifyRoundtrip(input);
    default: {
      const exhaustive: never = input;
      return { ok: false, error: `Unsupported bridge op: ${JSON.stringify(exhaustive)}` };
    }
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  const input = JSON.parse(trimmed) as BridgeInput;
  const output = processInput(input);
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
