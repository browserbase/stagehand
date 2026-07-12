import type { z } from "zod/v4";
import type {
  StagehandRpcNotificationSchema,
  StagehandRpcRequestSchema,
} from "./schema-registry.js";
import type {
  ActionSchema,
  ActOptionsSchema,
  ActResultDataSchema,
  ActResultSchema,
  AzureApiKeyModelConfigObjectSchema,
  AzureEntraIdAuthSchema,
  AzureEntraModelConfigObjectSchema,
  AzureModelConfigObjectSchema,
  AzureModelProviderOptionsSchema,
  AzureProviderOptionsSchema,
  BrowserGetVersionResultSchema,
  ContextNewPageParamsSchema,
  ContextPagesResultSchema,
  EmptyParamsSchema,
  ExtractOptionsSchema,
  ExtractResultSchema,
  GenericModelConfigObjectSchema,
  GoogleServiceAccountAuthSchema,
  GoogleServiceAccountCredentialsSchema,
  LocatorClickParamsSchema,
  LocatorClickResultSchema,
  LocatorCoordinatesSchema,
  LocatorDescriptorSchema,
  LocatorFillParamsSchema,
  LocatorFillResultSchema,
  LocatorIsVisibleResultSchema,
  LocatorSchema,
  LocatorTextContentResultSchema,
  ModelConfigObjectSchema,
  ModelConfigSchema,
  ObserveOptionsSchema,
  ObserveResultSchema,
  PageCloseResultSchema,
  PageGotoParamsSchema,
  PageIdParamsSchema,
  PageLocatorSchema,
  PageRefSchema,
  PageTitleResultSchema,
  PageUrlResultSchema,
  RuntimeConfigureParamsSchema,
  RuntimeConfigureResultSchema,
  RuntimeLoopbackStatusResultSchema,
  StagehandActParamsSchema,
  StagehandCloseResultSchema,
  StagehandExtractParamsSchema,
  StagehandInitParamsSchema,
  StagehandInitResultSchema,
  StagehandLogEventSchema,
  StagehandMetricsSchema,
  StagehandObserveParamsSchema,
  StagehandPingResultSchema,
  VariablePrimitiveSchema,
  VariablesSchema,
  VariableValueSchema,
  VertexModelConfigObjectSchema,
  VertexModelProviderOptionsSchema,
  VertexProviderOptionsSchema,
} from "./schemas.js";

export type VariablePrimitive = z.infer<typeof VariablePrimitiveSchema>;
export type VariableValue = z.infer<typeof VariableValueSchema>;
export type Variables = z.infer<typeof VariablesSchema>;
export type LocatorCoordinates = z.infer<typeof LocatorCoordinatesSchema>;
export type PageLocator = z.infer<typeof PageLocatorSchema>;
export type Locator = z.infer<typeof LocatorSchema>;
export type StagehandMetrics = z.infer<typeof StagehandMetricsSchema>;
export type GoogleServiceAccountCredentials = z.infer<typeof GoogleServiceAccountCredentialsSchema>;
export type GoogleServiceAccountAuth = z.infer<typeof GoogleServiceAccountAuthSchema>;
export type AzureEntraIdAuth = z.infer<typeof AzureEntraIdAuthSchema>;
export type VertexProviderOptions = z.infer<typeof VertexProviderOptionsSchema>;
export type AzureProviderOptions = z.infer<typeof AzureProviderOptionsSchema>;
export type VertexModelProviderOptions = z.infer<typeof VertexModelProviderOptionsSchema>;
export type AzureModelProviderOptions = z.infer<typeof AzureModelProviderOptionsSchema>;
export type GenericModelConfigObject = z.infer<typeof GenericModelConfigObjectSchema>;
export type VertexModelConfigObject = z.infer<typeof VertexModelConfigObjectSchema>;
export type AzureEntraModelConfigObject = z.infer<typeof AzureEntraModelConfigObjectSchema>;
export type AzureApiKeyModelConfigObject = z.infer<typeof AzureApiKeyModelConfigObjectSchema>;
export type AzureModelConfigObject = z.infer<typeof AzureModelConfigObjectSchema>;
export type ModelConfigObject = z.infer<typeof ModelConfigObjectSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type ActOptions = z.infer<typeof ActOptionsSchema>;
export type ActResultData = z.infer<typeof ActResultDataSchema>;
export type ActResult = z.infer<typeof ActResultSchema>;
export type ExtractOptions = z.infer<typeof ExtractOptionsSchema>;
export type ExtractResult = z.infer<typeof ExtractResultSchema>;
export type ObserveOptions = z.infer<typeof ObserveOptionsSchema>;
export type ObserveResult = z.infer<typeof ObserveResultSchema>;
export type EmptyParams = z.infer<typeof EmptyParamsSchema>;
export type PageRef = z.infer<typeof PageRefSchema>;
export type LocatorDescriptor = z.infer<typeof LocatorDescriptorSchema>;
export type StagehandInitParams = z.infer<typeof StagehandInitParamsSchema>;
export type RuntimeConfigureParams = z.infer<typeof RuntimeConfigureParamsSchema>;
export type StagehandActParams = z.infer<typeof StagehandActParamsSchema>;
export type StagehandObserveParams = z.infer<typeof StagehandObserveParamsSchema>;
export type StagehandExtractParams = z.infer<typeof StagehandExtractParamsSchema>;
export type ContextNewPageParams = z.infer<typeof ContextNewPageParamsSchema>;
export type PageGotoParams = z.infer<typeof PageGotoParamsSchema>;
export type PageIdParams = z.infer<typeof PageIdParamsSchema>;
export type LocatorClickParams = z.infer<typeof LocatorClickParamsSchema>;
export type LocatorFillParams = z.infer<typeof LocatorFillParamsSchema>;
export type StagehandPingResult = z.infer<typeof StagehandPingResultSchema>;
export type RuntimeConfigureResult = z.infer<typeof RuntimeConfigureResultSchema>;
export type RuntimeLoopbackStatusResult = z.infer<typeof RuntimeLoopbackStatusResultSchema>;
export type BrowserGetVersionResult = z.infer<typeof BrowserGetVersionResultSchema>;
export type StagehandInitResult = z.infer<typeof StagehandInitResultSchema>;
export type StagehandCloseResult = z.infer<typeof StagehandCloseResultSchema>;
export type ContextPagesResult = z.infer<typeof ContextPagesResultSchema>;
export type PageUrlResult = z.infer<typeof PageUrlResultSchema>;
export type PageTitleResult = z.infer<typeof PageTitleResultSchema>;
export type PageCloseResult = z.infer<typeof PageCloseResultSchema>;
export type LocatorClickResult = z.infer<typeof LocatorClickResultSchema>;
export type LocatorFillResult = z.infer<typeof LocatorFillResultSchema>;
export type LocatorIsVisibleResult = z.infer<typeof LocatorIsVisibleResultSchema>;
export type LocatorTextContentResult = z.infer<typeof LocatorTextContentResultSchema>;
export type StagehandLogEvent = z.infer<typeof StagehandLogEventSchema>;
export type StagehandRpcRequest = z.infer<typeof StagehandRpcRequestSchema>;
export type StagehandRpcNotification = z.infer<typeof StagehandRpcNotificationSchema>;
