// Export api.ts under namespace to avoid conflicts with methods.ts types
export * as Api from "./api.js";
// Also export BrowserbaseRegion directly for convenience
export type { BrowserbaseRegion } from "./schemas.js";
export * from "./clipboard.js";
export {
  ClipboardOptionsSchema,
  ClipboardPasteOptionsSchema,
  LocatorCoordinatesSchema,
  LocatorSchema,
  ModelNameSchema,
  PageLocatorSchema,
  V3FunctionNameSchema,
  VariablePrimitiveSchema,
  VariableValueSchema,
  VariablesSchema,
} from "./schemas.js";
export * from "./logs.js";
export * from "./methods.js";
export * from "./metrics.js";
export * from "./model.js";
export * from "./options.js";
export * from "./page.js";
export * from "./sdkErrors.js";
export * from "./context.js";
export * from "./variables.js";
