import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// @ts-expect-error - meta works in vitest
const supportDir = dirname(fileURLToPath(import.meta.url));
const envFilePath = resolve(supportDir, "../.env");

type StagehandEnvScope = "client" | "server";

let envLoaded = false;

export function ensureTestEnvLoaded() {
  if (envLoaded) return;
  envLoaded = true;

  if (!existsSync(envFilePath)) return;

  const result = loadDotenv({ path: envFilePath });
  if (result.error) {
    throw result.error;
  }
}

function scopedEnvKey(name: string, scope?: StagehandEnvScope) {
  if (!scope) return undefined;
  return `STAGEHAND_${scope.toUpperCase()}_${name}`;
}

export function getStagehandEnvVar(
  name: string,
  options?: { scope?: StagehandEnvScope },
) {
  ensureTestEnvLoaded();
  const scopedKey = scopedEnvKey(name, options?.scope);

  const scopedValue = scopedKey ? process.env[scopedKey] : undefined;
  if (scopedValue && scopedValue.length > 0) {
    return scopedValue;
  }

  const defaultValue = process.env[name];
  if (defaultValue && defaultValue.length > 0) {
    return defaultValue;
  }

  return undefined;
}

export function requireStagehandEnvVar(
  name: string,
  options?: { scope?: StagehandEnvScope; consumer?: string },
) {
  const value = getStagehandEnvVar(name, options);
  if (value) return value;

  const scopedKey = scopedEnvKey(name, options?.scope);
  const expected = scopedKey ? `${scopedKey} or ${name}` : name;
  const consumerSuffix = options?.consumer
    ? ` for ${options.consumer}`
    : "";

  throw new Error(
    `Missing ${name}${consumerSuffix}. Provide ${expected} via tests/.env or your shell environment.`,
  );
}

ensureTestEnvLoaded();
