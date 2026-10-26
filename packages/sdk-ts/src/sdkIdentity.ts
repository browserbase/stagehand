import { STAGEHAND_SDK_VERSION } from "./version.js";

const STAGEHAND_SDK_IDENTITY = {
  name: "stagehand-sdk-ts",
  language: "typescript",
  version: STAGEHAND_SDK_VERSION,
} as const;

export const STAGEHAND_SDK_CLIENT_INFO = {
  name: STAGEHAND_SDK_IDENTITY.name,
  version: STAGEHAND_SDK_IDENTITY.version,
} as const;

export const STAGEHAND_SESSION_METADATA = {
  stagehand: "true",
  stagehand_sdk_language: STAGEHAND_SDK_IDENTITY.language,
  stagehand_sdk_version: STAGEHAND_SDK_IDENTITY.version,
} as const;
