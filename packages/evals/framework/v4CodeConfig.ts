import fs from "node:fs";
import path from "node:path";

export const STAGEHAND_V4_SDK_PATH_ENV = "STAGEHAND_V4_SDK_PATH";

export function resolveV4SdkPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[STAGEHAND_V4_SDK_PATH_ENV]?.trim();
  if (!configured) {
    throw new Error(
      `${STAGEHAND_V4_SDK_PATH_ENV} must point to the V4 TypeScript SDK entry file.`,
    );
  }

  const resolved = path.resolve(configured);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(
      `${STAGEHAND_V4_SDK_PATH_ENV} does not point to a file: ${resolved}`,
    );
  }
  return resolved;
}
