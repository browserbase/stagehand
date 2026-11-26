import packageJson from "./package.json" with { type: "json" };

export const STAGEHAND_RUNTIME_VERSION = packageJson.version;

export const EXTENSION_BUILD_ID_FILE = "build-id.txt";
export const EXTENSION_BUILD_ID_GLOBAL = "__stagehand_build_id";

export const STAGEHAND_EXTENSION_BUILD_ID = "__STAGEHAND_EXTENSION_BUILD_ID__";
