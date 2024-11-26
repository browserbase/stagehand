import crypto from "crypto";
import { LogLine } from "../types/log";

export function generateId(operation: string) {
  return crypto.createHash("sha256").update(operation).digest("hex");
}

export function logLineToString(logLine: LogLine): string {
  const timestamp = logLine.timestamp || new Date().toISOString();
  if (logLine.auxiliary?.error) {
    return `${timestamp}::[stagehand:${logLine.category}] ${logLine.message}\n ${logLine.auxiliary.error.value}\n ${logLine.auxiliary.trace.value}`;
  }
  return `${timestamp}::[stagehand:${logLine.category}] ${logLine.message} ${
    logLine.auxiliary ? JSON.stringify(logLine.auxiliary) : ""
  }`;
}
