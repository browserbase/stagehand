import { expectTypeOf } from "vite-plus/test";
import {
  ActionSchema,
  ActOptionsSchema,
  ActRequestSchema,
  ActResponseSchema,
  ActResultDataSchema,
  ActResultSchema,
  AnthropicClientOptionsSchema,
  ApiKeyAuthSchema,
  ApiKeyClientOptionsSchema,
  ApiKeyResolvedProviderClientOptionsSchema,
  AzureApiKeyClientOptionsSchema,
  AzureEntraClientOptionsSchema,
  ClientOptionsBaseSchema,
  AzureApiKeyModelConfigObjectSchema,
  AzureEntraIdAuthSchema,
  AzureEntraModelConfigObjectSchema,
  AzureModelConfigObjectSchema,
  AzureModelProviderOptionsSchema,
  AzureProviderOptionsSchema,
  AzureResolvedProviderClientOptionsSchema,
  BrowserConfigSchema,
  BrowserbaseBrowserSettingsSchema,
  BrowserbaseContextSchema,
  BrowserbaseFingerprintSchema,
  BrowserbaseFingerprintScreenSchema,
  BrowserbaseProxyConfigSchema,
  BrowserbaseProxyGeolocationSchema,
  BrowserbaseRegionSchema,
  BrowserbaseConnectOptionsSchema,
  BrowserbaseSessionCreateParamsSchema,
  BrowserbaseViewportSchema,
  ClientOptionsSchema,
  ClipboardOptionsSchema,
  ClipboardPasteOptionsSchema,
  ExtractOptionsSchema,
  ExtractRequestSchema,
  ExtractResponseSchema,
  ExtractResultSchema,
  ExternalProxyConfigSchema,
  GenericModelConfigObjectSchema,
  GoogleServiceAccountAuthSchema,
  GoogleServiceAccountCredentialsSchema,
  LocalBrowserConnectOptionsSchema,
  LocalBrowserLaunchOptionsSchema,
  LLMToolSchema,
  LocatorCoordinatesSchema,
  LocatorSchema,
  ModelAuthSchema,
  ModelConfigSchema,
  ModelNameSchema,
  ModelProviderSchema,
  ModelProviderOptionsSchema,
  NavigateRequestSchema,
  NavigateResponseSchema,
  NavigateResultSchema,
  ObserveOptionsSchema,
  ObserveRequestSchema,
  ObserveResponseSchema,
  ObserveResultSchema,
  OpenAIClientOptionsSchema,
  OllamaResolvedProviderClientOptionsSchema,
  PageLocatorSchema,
  ProxyConfigSchema,
  ReplayActionSchema,
  ReplayPageSchema,
  ReplayResponseSchema,
  ReplayResultSchema,
  ResolvedProviderClientOptionsSchema,
  SessionEndResponseSchema,
  SessionEndResultSchema,
  SessionHeadersSchema,
  SessionIdParamsSchema,
  SessionStartRequestSchema,
  SessionStartResponseSchema,
  SessionStartResultSchema,
  StreamEventLogDataSchema,
  StreamEventSchema,
  StreamEventStatusSchema,
  StreamEventSystemDataSchema,
  StreamEventTypeSchema,
  StagehandOptionsSchema,
  ThinkingEffortSchema,
  TokenUsageSchema,
  V3FunctionNameSchema,
  VariablesSchema,
  VariablePrimitiveSchema,
  VariableValueSchema,
  VertexModelConfigObjectSchema,
  VertexClientOptionsSchema,
  VertexModelProviderOptionsSchema,
  VertexProviderOptionsSchema,
  VertexResolvedProviderClientOptionsSchema,
} from "../../../server/types/public/schemas.js";
import * as PublicSchemas from "../../../server/types/public/schemas.js";
import type * as Api from "../../../server/types/public/api.js";
import type * as Public from "../../../server/types/public/index.js";

type SchemaOutput<TSchema> = TSchema extends { _output: infer TOutput }
  ? NonNullable<TOutput>
  : never;
type SchemaInput<TSchema> = TSchema extends { _input: infer TInput } ? NonNullable<TInput> : never;
type UnknownExtractResult = {
  result: unknown;
  actionId?: string;
  cacheStatus?: "HIT" | "MISS";
};
type IsEqual<TActual, TExpected> =
  (<T>() => T extends TActual ? 1 : 2) extends <T>() => T extends TExpected ? 1 : 2
    ? (<T>() => T extends TExpected ? 1 : 2) extends <T>() => T extends TActual ? 1 : 2
      ? true
      : false
    : false;
type AssertTrue<T extends true> = T;
type OutputKeys<TSchema> = keyof SchemaOutput<TSchema>;
type InputKeys<TSchema> = keyof SchemaInput<TSchema>;

// Public SDK/schema parity. These assertions should fail whenever a public
// TypeScript type and its matching public Zod schema drift apart.
expectTypeOf<SchemaOutput<typeof ModelNameSchema>>().toEqualTypeOf<Public.ModelName>();
expectTypeOf<SchemaInput<typeof ModelNameSchema>>().toEqualTypeOf<Public.ModelName>();

expectTypeOf<
  SchemaOutput<typeof OpenAIClientOptionsSchema>
>().toEqualTypeOf<Public.OpenAIClientOptions>();
expectTypeOf<
  SchemaInput<typeof OpenAIClientOptionsSchema>
>().toEqualTypeOf<Public.OpenAIClientOptions>();

expectTypeOf<
  SchemaOutput<typeof AnthropicClientOptionsSchema>
>().toEqualTypeOf<Public.AnthropicClientOptions>();
expectTypeOf<
  SchemaInput<typeof AnthropicClientOptionsSchema>
>().toEqualTypeOf<Public.AnthropicClientOptions>();

expectTypeOf<SchemaOutput<typeof ApiKeyAuthSchema>>().toEqualTypeOf<Public.ApiKeyAuth>();
expectTypeOf<SchemaInput<typeof ApiKeyAuthSchema>>().toEqualTypeOf<Public.ApiKeyAuth>();

expectTypeOf<SchemaOutput<typeof ModelProviderSchema>>().toEqualTypeOf<Public.ModelProvider>();
expectTypeOf<SchemaInput<typeof ModelProviderSchema>>().toEqualTypeOf<Public.ModelProvider>();

expectTypeOf<SchemaOutput<typeof ThinkingEffortSchema>>().toEqualTypeOf<Public.ThinkingEffort>();
expectTypeOf<SchemaInput<typeof ThinkingEffortSchema>>().toEqualTypeOf<Public.ThinkingEffort>();

expectTypeOf<SchemaOutput<typeof V3FunctionNameSchema>>().toEqualTypeOf<Public.V3FunctionName>();
expectTypeOf<SchemaInput<typeof V3FunctionNameSchema>>().toEqualTypeOf<Public.V3FunctionName>();

expectTypeOf<
  SchemaOutput<typeof GoogleServiceAccountCredentialsSchema>
>().toEqualTypeOf<Public.GoogleServiceAccountCredentials>();
expectTypeOf<
  SchemaInput<typeof GoogleServiceAccountCredentialsSchema>
>().toEqualTypeOf<Public.GoogleServiceAccountCredentials>();

expectTypeOf<
  SchemaOutput<typeof GoogleServiceAccountAuthSchema>
>().toEqualTypeOf<Public.GoogleServiceAccountAuth>();
expectTypeOf<
  SchemaInput<typeof GoogleServiceAccountAuthSchema>
>().toEqualTypeOf<Public.GoogleServiceAccountAuth>();

expectTypeOf<
  SchemaOutput<typeof AzureEntraIdAuthSchema>
>().toEqualTypeOf<Public.AzureEntraIdAuth>();
expectTypeOf<SchemaInput<typeof AzureEntraIdAuthSchema>>().toEqualTypeOf<Public.AzureEntraIdAuth>();

expectTypeOf<SchemaOutput<typeof ModelAuthSchema>>().toEqualTypeOf<Public.ModelAuth>();
expectTypeOf<SchemaInput<typeof ModelAuthSchema>>().toEqualTypeOf<Public.ModelAuth>();

expectTypeOf<
  SchemaOutput<typeof VertexProviderOptionsSchema>
>().toEqualTypeOf<Public.VertexProviderOptions>();
expectTypeOf<
  SchemaInput<typeof VertexProviderOptionsSchema>
>().toEqualTypeOf<Public.VertexProviderOptions>();

expectTypeOf<
  SchemaOutput<typeof AzureProviderOptionsSchema>
>().toEqualTypeOf<Public.AzureProviderOptions>();
expectTypeOf<
  SchemaInput<typeof AzureProviderOptionsSchema>
>().toEqualTypeOf<Public.AzureProviderOptions>();

expectTypeOf<
  SchemaOutput<typeof ModelProviderOptionsSchema>
>().toEqualTypeOf<Public.ModelProviderOptions>();
expectTypeOf<
  SchemaInput<typeof ModelProviderOptionsSchema>
>().toEqualTypeOf<Public.ModelProviderOptions>();

expectTypeOf<SchemaOutput<typeof ClientOptionsSchema>>().toEqualTypeOf<Public.ClientOptions>();
expectTypeOf<SchemaInput<typeof ClientOptionsSchema>>().toEqualTypeOf<Public.ClientOptions>();

expectTypeOf<
  SchemaOutput<typeof ClientOptionsBaseSchema>
>().toEqualTypeOf<Public.ClientOptionsBase>();
expectTypeOf<
  SchemaInput<typeof ClientOptionsBaseSchema>
>().toEqualTypeOf<Public.ClientOptionsBase>();

expectTypeOf<
  SchemaOutput<typeof ApiKeyClientOptionsSchema>
>().toEqualTypeOf<Public.ApiKeyClientOptions>();
expectTypeOf<
  SchemaInput<typeof ApiKeyClientOptionsSchema>
>().toEqualTypeOf<Public.ApiKeyClientOptions>();

expectTypeOf<
  SchemaOutput<typeof VertexClientOptionsSchema>
>().toEqualTypeOf<Public.VertexClientOptions>();
expectTypeOf<
  SchemaInput<typeof VertexClientOptionsSchema>
>().toEqualTypeOf<Public.VertexClientOptions>();

expectTypeOf<
  SchemaOutput<typeof AzureApiKeyClientOptionsSchema>
>().toEqualTypeOf<Public.AzureApiKeyClientOptions>();
expectTypeOf<
  SchemaInput<typeof AzureApiKeyClientOptionsSchema>
>().toEqualTypeOf<Public.AzureApiKeyClientOptions>();

expectTypeOf<
  SchemaOutput<typeof AzureEntraClientOptionsSchema>
>().toEqualTypeOf<Public.AzureEntraClientOptions>();
expectTypeOf<
  SchemaInput<typeof AzureEntraClientOptionsSchema>
>().toEqualTypeOf<Public.AzureEntraClientOptions>();

expectTypeOf<
  SchemaOutput<typeof ApiKeyResolvedProviderClientOptionsSchema>
>().toEqualTypeOf<Public.ApiKeyResolvedProviderClientOptions>();
expectTypeOf<
  SchemaInput<typeof ApiKeyResolvedProviderClientOptionsSchema>
>().toEqualTypeOf<Public.ApiKeyResolvedProviderClientOptions>();

expectTypeOf<
  SchemaOutput<typeof AzureResolvedProviderClientOptionsSchema>
>().toEqualTypeOf<Public.AzureResolvedProviderClientOptions>();
expectTypeOf<
  SchemaInput<typeof AzureResolvedProviderClientOptionsSchema>
>().toEqualTypeOf<Public.AzureResolvedProviderClientOptions>();

expectTypeOf<
  SchemaOutput<typeof VertexResolvedProviderClientOptionsSchema>
>().toEqualTypeOf<Public.VertexResolvedProviderClientOptions>();
expectTypeOf<
  SchemaInput<typeof VertexResolvedProviderClientOptionsSchema>
>().toEqualTypeOf<Public.VertexResolvedProviderClientOptions>();

expectTypeOf<
  SchemaOutput<typeof OllamaResolvedProviderClientOptionsSchema>
>().toEqualTypeOf<Public.OllamaResolvedProviderClientOptions>();
expectTypeOf<
  SchemaInput<typeof OllamaResolvedProviderClientOptionsSchema>
>().toEqualTypeOf<Public.OllamaResolvedProviderClientOptions>();

expectTypeOf<
  SchemaOutput<typeof ResolvedProviderClientOptionsSchema>
>().toEqualTypeOf<Public.ResolvedProviderClientOptions>();
expectTypeOf<
  SchemaInput<typeof ResolvedProviderClientOptionsSchema>
>().toEqualTypeOf<Public.ResolvedProviderClientOptions>();

expectTypeOf<SchemaOutput<typeof ModelConfigSchema>>().toEqualTypeOf<Public.ModelConfiguration>();
expectTypeOf<SchemaInput<typeof ModelConfigSchema>>().toEqualTypeOf<Public.ModelConfiguration>();

expectTypeOf<SchemaOutput<typeof ActionSchema>>().toEqualTypeOf<Public.Action>();
expectTypeOf<SchemaInput<typeof ActionSchema>>().toEqualTypeOf<Public.Action>();

expectTypeOf<SchemaOutput<typeof ActOptionsSchema>>().toEqualTypeOf<Public.ActOptions>();
expectTypeOf<SchemaInput<typeof ActOptionsSchema>>().toEqualTypeOf<Public.ActOptions>();

expectTypeOf<SchemaOutput<typeof ActResultDataSchema>>().toEqualTypeOf<Public.ActResultData>();
expectTypeOf<SchemaInput<typeof ActResultDataSchema>>().toEqualTypeOf<Public.ActResultData>();

expectTypeOf<SchemaOutput<typeof ActResultSchema>>().toEqualTypeOf<Public.ActResult>();
expectTypeOf<SchemaInput<typeof ActResultSchema>>().toEqualTypeOf<Public.ActResult>();

expectTypeOf<SchemaOutput<typeof ExtractOptionsSchema>>().toEqualTypeOf<Public.ExtractOptions>();
expectTypeOf<SchemaInput<typeof ExtractOptionsSchema>>().toEqualTypeOf<Public.ExtractOptions>();

expectTypeOf<SchemaOutput<typeof ExtractResultSchema>>().toEqualTypeOf<UnknownExtractResult>();
expectTypeOf<SchemaInput<typeof ExtractResultSchema>>().toEqualTypeOf<UnknownExtractResult>();

expectTypeOf<SchemaOutput<typeof ObserveOptionsSchema>>().toEqualTypeOf<Public.ObserveOptions>();
expectTypeOf<SchemaInput<typeof ObserveOptionsSchema>>().toEqualTypeOf<Public.ObserveOptions>();

expectTypeOf<SchemaOutput<typeof ObserveResultSchema>>().toEqualTypeOf<Public.ObserveResult>();
expectTypeOf<SchemaInput<typeof ObserveResultSchema>>().toEqualTypeOf<Public.ObserveResult>();

expectTypeOf<
  SchemaOutput<typeof VariablePrimitiveSchema>
>().toEqualTypeOf<Public.VariablePrimitive>();
expectTypeOf<
  SchemaInput<typeof VariablePrimitiveSchema>
>().toEqualTypeOf<Public.VariablePrimitive>();

expectTypeOf<SchemaOutput<typeof VariableValueSchema>>().toEqualTypeOf<Public.VariableValue>();
expectTypeOf<SchemaInput<typeof VariableValueSchema>>().toEqualTypeOf<Public.VariableValue>();

expectTypeOf<SchemaOutput<typeof VariablesSchema>>().toEqualTypeOf<Public.Variables>();
expectTypeOf<SchemaInput<typeof VariablesSchema>>().toEqualTypeOf<Public.Variables>();

expectTypeOf<
  SchemaOutput<typeof LocalBrowserLaunchOptionsSchema>
>().toEqualTypeOf<Public.LocalBrowserLaunchOptions>();
expectTypeOf<
  SchemaInput<typeof LocalBrowserLaunchOptionsSchema>
>().toEqualTypeOf<Public.LocalBrowserLaunchOptions>();
expectTypeOf<
  SchemaOutput<typeof LocalBrowserConnectOptionsSchema>
>().toEqualTypeOf<Public.LocalBrowserConnectOptions>();
expectTypeOf<
  SchemaInput<typeof LocalBrowserConnectOptionsSchema>
>().toEqualTypeOf<Public.LocalBrowserConnectOptions>();
expectTypeOf<
  SchemaOutput<typeof BrowserbaseConnectOptionsSchema>
>().toEqualTypeOf<Public.BrowserbaseConnectOptions>();
expectTypeOf<
  SchemaInput<typeof BrowserbaseConnectOptionsSchema>
>().toEqualTypeOf<Public.BrowserbaseConnectOptions>();
expectTypeOf<
  SchemaOutput<typeof StagehandOptionsSchema>
>().toEqualTypeOf<Public.StagehandOptions>();
expectTypeOf<SchemaInput<typeof StagehandOptionsSchema>>().toEqualTypeOf<Public.StagehandOptions>();

expectTypeOf<SchemaOutput<typeof LLMToolSchema>>().toEqualTypeOf<Public.LLMTool>();
expectTypeOf<SchemaInput<typeof LLMToolSchema>>().toEqualTypeOf<Public.LLMTool>();

expectTypeOf<
  SchemaOutput<typeof BrowserbaseRegionSchema>
>().toEqualTypeOf<Public.BrowserbaseRegion>();
expectTypeOf<
  SchemaInput<typeof BrowserbaseRegionSchema>
>().toEqualTypeOf<Public.BrowserbaseRegion>();

expectTypeOf<
  SchemaOutput<typeof LocatorCoordinatesSchema>
>().toEqualTypeOf<Public.LocatorCoordinates>();
expectTypeOf<
  SchemaInput<typeof LocatorCoordinatesSchema>
>().toEqualTypeOf<Public.LocatorCoordinates>();

expectTypeOf<SchemaOutput<typeof PageLocatorSchema>>().toEqualTypeOf<Public.PageLocator>();
expectTypeOf<SchemaInput<typeof PageLocatorSchema>>().toEqualTypeOf<Public.PageLocator>();

expectTypeOf<SchemaOutput<typeof LocatorSchema>>().toEqualTypeOf<Public.Locator>();
expectTypeOf<SchemaInput<typeof LocatorSchema>>().toEqualTypeOf<Public.Locator>();

expectTypeOf<
  SchemaOutput<typeof ClipboardOptionsSchema>
>().toEqualTypeOf<Public.ClipboardOptions>();
expectTypeOf<SchemaInput<typeof ClipboardOptionsSchema>>().toEqualTypeOf<Public.ClipboardOptions>();

expectTypeOf<
  SchemaOutput<typeof ClipboardPasteOptionsSchema>
>().toEqualTypeOf<Public.ClipboardPasteOptions>();
expectTypeOf<
  SchemaInput<typeof ClipboardPasteOptionsSchema>
>().toEqualTypeOf<Public.ClipboardPasteOptions>();

// Optional fields can be invisible to structural assignability checks, so key
// equality is the public API drift guard that catches missing optional fields.
type _GoogleServiceAccountCredentialsOutputKeys = AssertTrue<
  IsEqual<
    OutputKeys<typeof GoogleServiceAccountCredentialsSchema>,
    keyof Public.GoogleServiceAccountCredentials
  >
>;
type _GoogleServiceAccountCredentialsInputKeys = AssertTrue<
  IsEqual<
    InputKeys<typeof GoogleServiceAccountCredentialsSchema>,
    keyof Public.GoogleServiceAccountCredentials
  >
>;
type _GoogleServiceAccountAuthOutputKeys = AssertTrue<
  IsEqual<OutputKeys<typeof GoogleServiceAccountAuthSchema>, keyof Public.GoogleServiceAccountAuth>
>;
type _GoogleServiceAccountAuthInputKeys = AssertTrue<
  IsEqual<InputKeys<typeof GoogleServiceAccountAuthSchema>, keyof Public.GoogleServiceAccountAuth>
>;
type _AzureEntraIdAuthOutputKeys = AssertTrue<
  IsEqual<OutputKeys<typeof AzureEntraIdAuthSchema>, keyof Public.AzureEntraIdAuth>
>;
type _AzureEntraIdAuthInputKeys = AssertTrue<
  IsEqual<InputKeys<typeof AzureEntraIdAuthSchema>, keyof Public.AzureEntraIdAuth>
>;
type _VertexProviderOptionsOutputKeys = AssertTrue<
  IsEqual<OutputKeys<typeof VertexProviderOptionsSchema>, keyof Public.VertexProviderOptions>
>;
type _VertexProviderOptionsInputKeys = AssertTrue<
  IsEqual<InputKeys<typeof VertexProviderOptionsSchema>, keyof Public.VertexProviderOptions>
>;
type _AzureProviderOptionsOutputKeys = AssertTrue<
  IsEqual<OutputKeys<typeof AzureProviderOptionsSchema>, keyof Public.AzureProviderOptions>
>;
type _AzureProviderOptionsInputKeys = AssertTrue<
  IsEqual<InputKeys<typeof AzureProviderOptionsSchema>, keyof Public.AzureProviderOptions>
>;
type _OpenAIClientOptionsOutputKeys = AssertTrue<
  IsEqual<OutputKeys<typeof OpenAIClientOptionsSchema>, keyof Public.OpenAIClientOptions>
>;
type _OpenAIClientOptionsInputKeys = AssertTrue<
  IsEqual<InputKeys<typeof OpenAIClientOptionsSchema>, keyof Public.OpenAIClientOptions>
>;
type _AnthropicClientOptionsOutputKeys = AssertTrue<
  IsEqual<OutputKeys<typeof AnthropicClientOptionsSchema>, keyof Public.AnthropicClientOptions>
>;
type _AnthropicClientOptionsInputKeys = AssertTrue<
  IsEqual<InputKeys<typeof AnthropicClientOptionsSchema>, keyof Public.AnthropicClientOptions>
>;
type _ClientOptionsOutputKeys = AssertTrue<
  IsEqual<OutputKeys<typeof ClientOptionsSchema>, keyof Public.ClientOptions>
>;
type _ClientOptionsInputKeys = AssertTrue<
  IsEqual<InputKeys<typeof ClientOptionsSchema>, keyof Public.ClientOptions>
>;
type _ModelConfigurationOutputKeys = AssertTrue<
  IsEqual<OutputKeys<typeof ModelConfigSchema>, keyof Public.ModelConfiguration>
>;
type _ModelConfigurationInputKeys = AssertTrue<
  IsEqual<InputKeys<typeof ModelConfigSchema>, keyof Public.ModelConfiguration>
>;
type _ActionOutputKeys = AssertTrue<IsEqual<OutputKeys<typeof ActionSchema>, keyof Public.Action>>;
type _ActionInputKeys = AssertTrue<IsEqual<InputKeys<typeof ActionSchema>, keyof Public.Action>>;
type _ActOptionsOutputKeys = AssertTrue<
  IsEqual<OutputKeys<typeof ActOptionsSchema>, keyof Public.ActOptions>
>;
type _ActOptionsInputKeys = AssertTrue<
  IsEqual<InputKeys<typeof ActOptionsSchema>, keyof Public.ActOptions>
>;
type _ActResultDataOutputKeys = AssertTrue<
  IsEqual<OutputKeys<typeof ActResultDataSchema>, keyof Public.ActResultData>
>;
type _ActResultDataInputKeys = AssertTrue<
  IsEqual<InputKeys<typeof ActResultDataSchema>, keyof Public.ActResultData>
>;
type _ActResultOutputKeys = AssertTrue<
  IsEqual<OutputKeys<typeof ActResultSchema>, keyof Public.ActResult>
>;
type _ActResultInputKeys = AssertTrue<
  IsEqual<InputKeys<typeof ActResultSchema>, keyof Public.ActResult>
>;
type _ExtractOptionsOutputKeys = AssertTrue<
  IsEqual<OutputKeys<typeof ExtractOptionsSchema>, keyof Public.ExtractOptions>
>;
type _ExtractOptionsInputKeys = AssertTrue<
  IsEqual<InputKeys<typeof ExtractOptionsSchema>, keyof Public.ExtractOptions>
>;
type _ExtractResultOutputKeys = AssertTrue<
  IsEqual<OutputKeys<typeof ExtractResultSchema>, keyof UnknownExtractResult>
>;
type _ExtractResultInputKeys = AssertTrue<
  IsEqual<InputKeys<typeof ExtractResultSchema>, keyof UnknownExtractResult>
>;
type _ObserveOptionsOutputKeys = AssertTrue<
  IsEqual<OutputKeys<typeof ObserveOptionsSchema>, keyof Public.ObserveOptions>
>;
type _ObserveOptionsInputKeys = AssertTrue<
  IsEqual<InputKeys<typeof ObserveOptionsSchema>, keyof Public.ObserveOptions>
>;
type _ObserveResultOutputKeys = AssertTrue<
  IsEqual<OutputKeys<typeof ObserveResultSchema>, keyof Public.ObserveResult>
>;
type _ObserveResultInputKeys = AssertTrue<
  IsEqual<InputKeys<typeof ObserveResultSchema>, keyof Public.ObserveResult>
>;
type _LocalBrowserLaunchOptionsOutputKeys = AssertTrue<
  IsEqual<
    OutputKeys<typeof LocalBrowserLaunchOptionsSchema>,
    keyof Public.LocalBrowserLaunchOptions
  >
>;
type _LocalBrowserLaunchOptionsInputKeys = AssertTrue<
  IsEqual<InputKeys<typeof LocalBrowserLaunchOptionsSchema>, keyof Public.LocalBrowserLaunchOptions>
>;
type _LocalBrowserConnectOptionsOutputKeys = AssertTrue<
  IsEqual<
    OutputKeys<typeof LocalBrowserConnectOptionsSchema>,
    keyof Public.LocalBrowserConnectOptions
  >
>;
type _LocalBrowserConnectOptionsInputKeys = AssertTrue<
  IsEqual<
    InputKeys<typeof LocalBrowserConnectOptionsSchema>,
    keyof Public.LocalBrowserConnectOptions
  >
>;
type _BrowserbaseConnectOptionsOutputKeys = AssertTrue<
  IsEqual<
    OutputKeys<typeof BrowserbaseConnectOptionsSchema>,
    keyof Public.BrowserbaseConnectOptions
  >
>;
type _BrowserbaseConnectOptionsInputKeys = AssertTrue<
  IsEqual<InputKeys<typeof BrowserbaseConnectOptionsSchema>, keyof Public.BrowserbaseConnectOptions>
>;
type _StagehandOptionsOutputKeys = AssertTrue<
  IsEqual<OutputKeys<typeof StagehandOptionsSchema>, keyof Public.StagehandOptions>
>;
type _StagehandOptionsInputKeys = AssertTrue<
  IsEqual<InputKeys<typeof StagehandOptionsSchema>, keyof Public.StagehandOptions>
>;
type _LLMToolOutputKeys = AssertTrue<
  IsEqual<OutputKeys<typeof LLMToolSchema>, keyof Public.LLMTool>
>;
type _LLMToolInputKeys = AssertTrue<IsEqual<InputKeys<typeof LLMToolSchema>, keyof Public.LLMTool>>;
type _LocatorCoordinatesOutputKeys = AssertTrue<
  IsEqual<OutputKeys<typeof LocatorCoordinatesSchema>, keyof Public.LocatorCoordinates>
>;
type _LocatorCoordinatesInputKeys = AssertTrue<
  IsEqual<InputKeys<typeof LocatorCoordinatesSchema>, keyof Public.LocatorCoordinates>
>;
type _PageLocatorOutputKeys = AssertTrue<
  IsEqual<OutputKeys<typeof PageLocatorSchema>, keyof Public.PageLocator>
>;
type _PageLocatorInputKeys = AssertTrue<
  IsEqual<InputKeys<typeof PageLocatorSchema>, keyof Public.PageLocator>
>;
type _LocatorOutputKeys = AssertTrue<
  IsEqual<OutputKeys<typeof LocatorSchema>, keyof Public.Locator>
>;
type _LocatorInputKeys = AssertTrue<IsEqual<InputKeys<typeof LocatorSchema>, keyof Public.Locator>>;
type _ClipboardOptionsOutputKeys = AssertTrue<
  IsEqual<OutputKeys<typeof ClipboardOptionsSchema>, keyof Public.ClipboardOptions>
>;
type _ClipboardOptionsInputKeys = AssertTrue<
  IsEqual<InputKeys<typeof ClipboardOptionsSchema>, keyof Public.ClipboardOptions>
>;
type _ClipboardPasteOptionsOutputKeys = AssertTrue<
  IsEqual<OutputKeys<typeof ClipboardPasteOptionsSchema>, keyof Public.ClipboardPasteOptions>
>;
type _ClipboardPasteOptionsInputKeys = AssertTrue<
  IsEqual<InputKeys<typeof ClipboardPasteOptionsSchema>, keyof Public.ClipboardPasteOptions>
>;

// Public data types with existing canonical Zod schemas in public/schemas.ts.
type _HistoryEntrySchema = typeof PublicSchemas.HistoryEntrySchema;
expectTypeOf<SchemaOutput<_HistoryEntrySchema>>().toEqualTypeOf<Public.HistoryEntry>();
expectTypeOf<SchemaInput<_HistoryEntrySchema>>().toEqualTypeOf<Public.HistoryEntry>();

type _CookieSchema = typeof PublicSchemas.CookieSchema;
expectTypeOf<SchemaOutput<_CookieSchema>>().toEqualTypeOf<Public.Cookie>();
expectTypeOf<SchemaInput<_CookieSchema>>().toEqualTypeOf<Public.Cookie>();

type _CookieParamSchema = typeof PublicSchemas.CookieParamSchema;
expectTypeOf<SchemaOutput<_CookieParamSchema>>().toEqualTypeOf<Public.CookieParam>();
expectTypeOf<SchemaInput<_CookieParamSchema>>().toEqualTypeOf<Public.CookieParam>();

type _ClearCookieOptionsSchema = typeof PublicSchemas.ClearCookieOptionsSchema;
expectTypeOf<SchemaOutput<_ClearCookieOptionsSchema>>().toEqualTypeOf<Public.ClearCookieOptions>();
expectTypeOf<SchemaInput<_ClearCookieOptionsSchema>>().toEqualTypeOf<Public.ClearCookieOptions>();

type _DomainPolicySchema = typeof PublicSchemas.DomainPolicySchema;
expectTypeOf<SchemaOutput<_DomainPolicySchema>>().toEqualTypeOf<Public.DomainPolicy>();
expectTypeOf<SchemaInput<_DomainPolicySchema>>().toEqualTypeOf<Public.DomainPolicy>();

type _LogLevelSchema = typeof PublicSchemas.LogLevelSchema;
expectTypeOf<SchemaOutput<_LogLevelSchema>>().toEqualTypeOf<Public.LogLevel>();
expectTypeOf<SchemaInput<_LogLevelSchema>>().toEqualTypeOf<Public.LogLevel>();

type _LogLineSchema = typeof PublicSchemas.LogLineSchema;
expectTypeOf<SchemaOutput<_LogLineSchema>>().toEqualTypeOf<Public.LogLine>();
expectTypeOf<SchemaInput<_LogLineSchema>>().toEqualTypeOf<Public.LogLine>();

type _StagehandMetricsSchema = typeof PublicSchemas.StagehandMetricsSchema;
expectTypeOf<SchemaOutput<_StagehandMetricsSchema>>().toEqualTypeOf<Public.StagehandMetrics>();
expectTypeOf<SchemaInput<_StagehandMetricsSchema>>().toEqualTypeOf<Public.StagehandMetrics>();

type _StagehandOptionsSchema = typeof PublicSchemas.StagehandOptionsSchema;
expectTypeOf<SchemaOutput<_StagehandOptionsSchema>>().toEqualTypeOf<Public.StagehandOptions>();
expectTypeOf<SchemaInput<_StagehandOptionsSchema>>().toEqualTypeOf<Public.StagehandOptions>();

type _LoadStateSchema = typeof PublicSchemas.LoadStateSchema;
expectTypeOf<SchemaOutput<_LoadStateSchema>>().toEqualTypeOf<Public.LoadState>();
expectTypeOf<SchemaInput<_LoadStateSchema>>().toEqualTypeOf<Public.LoadState>();

type _SnapshotResultSchema = typeof PublicSchemas.SnapshotResultSchema;
expectTypeOf<SchemaOutput<_SnapshotResultSchema>>().toEqualTypeOf<Public.SnapshotResult>();
expectTypeOf<SchemaInput<_SnapshotResultSchema>>().toEqualTypeOf<Public.SnapshotResult>();

type _PageSnapshotOptionsSchema = typeof PublicSchemas.PageSnapshotOptionsSchema;
expectTypeOf<
  SchemaOutput<_PageSnapshotOptionsSchema>
>().toEqualTypeOf<Public.PageSnapshotOptions>();
expectTypeOf<SchemaInput<_PageSnapshotOptionsSchema>>().toEqualTypeOf<Public.PageSnapshotOptions>();

// Namespaced API/schema parity. These schemas are public under the Api
// namespace, not the top-level SDK type namespace.
expectTypeOf<
  SchemaOutput<typeof GenericModelConfigObjectSchema>
>().toEqualTypeOf<Api.GenericModelConfigObject>();
expectTypeOf<
  SchemaOutput<typeof VertexModelConfigObjectSchema>
>().toEqualTypeOf<Api.VertexModelConfigObject>();
expectTypeOf<
  SchemaOutput<typeof AzureModelConfigObjectSchema>
>().toEqualTypeOf<Api.AzureModelConfigObject>();
expectTypeOf<
  SchemaOutput<typeof AzureEntraModelConfigObjectSchema>
>().toEqualTypeOf<Api.AzureEntraModelConfigObject>();
expectTypeOf<
  SchemaOutput<typeof AzureApiKeyModelConfigObjectSchema>
>().toEqualTypeOf<Api.AzureApiKeyModelConfigObject>();
expectTypeOf<
  SchemaOutput<typeof VertexModelProviderOptionsSchema>
>().toEqualTypeOf<Api.VertexModelProviderOptions>();
expectTypeOf<
  SchemaOutput<typeof AzureModelProviderOptionsSchema>
>().toEqualTypeOf<Api.AzureModelProviderOptions>();
expectTypeOf<SchemaOutput<typeof BrowserConfigSchema>>().toEqualTypeOf<Api.BrowserConfig>();
expectTypeOf<SchemaOutput<typeof SessionIdParamsSchema>>().toEqualTypeOf<Api.SessionIdParams>();
expectTypeOf<SchemaOutput<typeof SessionHeadersSchema>>().toEqualTypeOf<Api.SessionHeaders>();
expectTypeOf<
  SchemaOutput<typeof BrowserbaseViewportSchema>
>().toEqualTypeOf<Api.BrowserbaseViewport>();
expectTypeOf<
  SchemaOutput<typeof BrowserbaseFingerprintScreenSchema>
>().toEqualTypeOf<Api.BrowserbaseFingerprintScreen>();
expectTypeOf<
  SchemaOutput<typeof BrowserbaseFingerprintSchema>
>().toEqualTypeOf<Api.BrowserbaseFingerprint>();
expectTypeOf<
  SchemaOutput<typeof BrowserbaseContextSchema>
>().toEqualTypeOf<Api.BrowserbaseContext>();
expectTypeOf<
  SchemaOutput<typeof BrowserbaseBrowserSettingsSchema>
>().toEqualTypeOf<Api.BrowserbaseBrowserSettings>();
expectTypeOf<
  SchemaOutput<typeof BrowserbaseProxyGeolocationSchema>
>().toEqualTypeOf<Api.BrowserbaseProxyGeolocation>();
expectTypeOf<
  SchemaOutput<typeof BrowserbaseProxyConfigSchema>
>().toEqualTypeOf<Api.BrowserbaseProxyConfig>();
expectTypeOf<
  SchemaOutput<typeof ExternalProxyConfigSchema>
>().toEqualTypeOf<Api.ExternalProxyConfig>();
expectTypeOf<SchemaOutput<typeof ProxyConfigSchema>>().toEqualTypeOf<Api.ProxyConfig>();
expectTypeOf<
  SchemaOutput<typeof BrowserbaseSessionCreateParamsSchema>
>().toEqualTypeOf<Api.BrowserbaseSessionCreateParams>();
expectTypeOf<
  SchemaOutput<typeof SessionStartRequestSchema>
>().toEqualTypeOf<Api.SessionStartRequest>();
expectTypeOf<
  SchemaOutput<typeof SessionStartResultSchema>
>().toEqualTypeOf<Api.SessionStartResult>();
expectTypeOf<
  SchemaOutput<typeof SessionStartResponseSchema>
>().toEqualTypeOf<Api.SessionStartResponse>();
expectTypeOf<SchemaOutput<typeof SessionEndResultSchema>>().toEqualTypeOf<Api.SessionEndResult>();
expectTypeOf<
  SchemaOutput<typeof SessionEndResponseSchema>
>().toEqualTypeOf<Api.SessionEndResponse>();
expectTypeOf<SchemaOutput<typeof ActRequestSchema>>().toEqualTypeOf<Api.ActRequest>();
expectTypeOf<SchemaOutput<typeof ActResultSchema>>().toEqualTypeOf<Api.ActResult>();
expectTypeOf<SchemaOutput<typeof ActResponseSchema>>().toEqualTypeOf<Api.ActResponse>();
expectTypeOf<SchemaOutput<typeof ExtractRequestSchema>>().toEqualTypeOf<Api.ExtractRequest>();
expectTypeOf<SchemaOutput<typeof ExtractResponseSchema>>().toEqualTypeOf<Api.ExtractResponse>();
expectTypeOf<SchemaOutput<typeof ObserveRequestSchema>>().toEqualTypeOf<Api.ObserveRequest>();
expectTypeOf<SchemaOutput<typeof ObserveResponseSchema>>().toEqualTypeOf<Api.ObserveResponse>();
expectTypeOf<SchemaOutput<typeof NavigateRequestSchema>>().toEqualTypeOf<Api.NavigateRequest>();
expectTypeOf<SchemaOutput<typeof NavigateResultSchema>>().toEqualTypeOf<Api.NavigateResult>();
expectTypeOf<SchemaOutput<typeof NavigateResponseSchema>>().toEqualTypeOf<Api.NavigateResponse>();
expectTypeOf<SchemaOutput<typeof TokenUsageSchema>>().toEqualTypeOf<Api.TokenUsage>();
expectTypeOf<SchemaOutput<typeof ReplayActionSchema>>().toEqualTypeOf<Api.ReplayAction>();
expectTypeOf<SchemaOutput<typeof ReplayPageSchema>>().toEqualTypeOf<Api.ReplayPage>();
expectTypeOf<SchemaOutput<typeof ReplayResultSchema>>().toEqualTypeOf<Api.ReplayResult>();
expectTypeOf<SchemaOutput<typeof ReplayResponseSchema>>().toEqualTypeOf<Api.ReplayResponse>();
expectTypeOf<SchemaOutput<typeof StreamEventStatusSchema>>().toEqualTypeOf<Api.StreamEventStatus>();
expectTypeOf<SchemaOutput<typeof StreamEventTypeSchema>>().toEqualTypeOf<Api.StreamEventType>();
expectTypeOf<
  SchemaOutput<typeof StreamEventSystemDataSchema>
>().toEqualTypeOf<Api.StreamEventSystemData>();
expectTypeOf<
  SchemaOutput<typeof StreamEventLogDataSchema>
>().toEqualTypeOf<Api.StreamEventLogData>();
expectTypeOf<SchemaOutput<typeof StreamEventSchema>>().toEqualTypeOf<Api.StreamEvent>();
