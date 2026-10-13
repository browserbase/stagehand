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
    if (!isRecord(raw)) throw invalidServer(label, name, "must be an object");
    if (typeof raw.command !== "string" || !raw.command) {
      throw invalidServer(label, name, "command must be a non-empty string");
    }
    const args = raw.args ?? [];
    if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
      throw invalidServer(label, name, "args must be an array of strings");
    }
    if (raw.env !== undefined && !isStringMap(raw.env)) {
      throw invalidServer(label, name, "env must be a string map");
    }
    if (raw.cwd !== undefined && typeof raw.cwd !== "string") {
      throw invalidServer(label, name, "cwd must be a string");
    }
    const env = isStringMap(raw.env) ? raw.env : undefined;
    normalized[name] = {
      command: raw.command,
      args: [...args],
      ...(env && { env: { ...env } }),
      ...(typeof raw.cwd === "string" && { cwd: raw.cwd }),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}
