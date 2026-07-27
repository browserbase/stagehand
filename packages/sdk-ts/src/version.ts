import packageJson from "../package.json" with { type: "json" };

export const STAGEHAND_SDK_VERSION = packageJson.version;
