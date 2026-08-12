import packageJson from "./package.json" with { type: "json" };

export const STAGEHAND_RUNTIME_VERSION = packageJson.version;
