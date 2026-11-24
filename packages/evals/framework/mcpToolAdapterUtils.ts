import { isRecord } from "@browserbasehq/stagehand-integrations/harness";
import type { ProbeEvidence } from "stagehand-v3";
import { EvalsError } from "../errors.js";

export interface StdioMcpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export function normalizeStdioMcpServers(
  mcpServers: Record<string, unknown>,
  label: string,
): Record<string, StdioMcpServerConfig> {
  const normalized: Record<string, StdioMcpServerConfig> = {};
  for (const [name, raw] of Object.entries(mcpServers)) {
    if (!isRecord(raw) || Array.isArray(raw)) {
      throw invalidServer(label, name, "must be an object");
    }
    const { command, env, cwd } = raw;
    if (typeof command !== "string" || !command.trim()) {
      throw invalidServer(label, name, "command must be a non-empty string");
    }
    const args = raw.args ?? [];
    if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
      throw invalidServer(label, name, "args must be an array of strings");
    }
    const normalizedEnv = isStringMap(env) ? { ...env } : undefined;
    if (env !== undefined && normalizedEnv === undefined) {
      throw invalidServer(label, name, "env must be a string map");
    }
    if (cwd !== undefined && typeof cwd !== "string") {
      throw invalidServer(label, name, "cwd must be a string");
    }
    normalized[name] = {
      command,
      args: [...args],
      ...(normalizedEnv && { env: normalizedEnv }),
      ...(typeof cwd === "string" && { cwd }),
    };
  }
  return normalized;
}

export function boundedCaptureEvidence(
  capture: () => Promise<ProbeEvidence>,
): () => Promise<ProbeEvidence> {
  return async () => {
    try {
      return await withCaptureTimeout(
        capture(),
        readCapturePositiveIntEnv("EVAL_CAPTURE_EVIDENCE_TIMEOUT_MS", 15_000),
      );
    } catch {
      return {};
    }
  };
}

export function readCapturePositiveIntEnv(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function withCaptureTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`agent mount operation timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function invalidServer(label: string, name: string, message: string): EvalsError {
  return new EvalsError(`Invalid ${label} MCP server "${name}": ${message}.`);
}

function isStringMap(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}
