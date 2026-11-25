import { logLineToString } from "./utils.js";
import { logToRow, type RowLogEntry } from "./framework/rowContext.js";
import { LogLineEval } from "./types/evals.js";
import { LogLine } from "stagehand-v3";
import type { V3 } from "stagehand-v3";

function parseLogLine(logLine: LogLine): LogLineEval {
  try {
    let parsedAuxiliary: Record<string, unknown> | undefined;

    if (logLine.auxiliary) {
      parsedAuxiliary = {};

      for (const [key, entry] of Object.entries(logLine.auxiliary)) {
        try {
          parsedAuxiliary[key] = entry.type === "object" ? JSON.parse(entry.value) : entry.value;
        } catch (parseError) {
          console.warn(`Failed to parse auxiliary entry ${key}:`, parseError);
          parsedAuxiliary[key] = entry.value;
        }
      }
    }

    return {
      ...logLine,
      auxiliary: undefined,
      parsedAuxiliary,
    } as LogLineEval;
  } catch (e) {
    console.log("Error parsing log line", logLine);
    console.error(e);
    return logLine;
  }
}

function toRowLogEntry(logLine: LogLine, defaultLevel?: number): RowLogEntry {
  const error = logLine.auxiliary?.error?.value;
  const trace = logLine.auxiliary?.trace?.value;
  const message = error ? `${logLine.message}: ${String(error)}` : logLine.message;
  const level = typeof logLine.level === "number" ? logLine.level : defaultLevel;
  return {
    category: logLine.category || "log",
    message: trace ? `${message}\n${String(trace)}` : message,
    ...(level !== undefined && { level }),
  };
}

export class EvalLogger {
  private logs: LogLineEval[] = [];
  private echo: boolean;
  stagehand?: V3;

  constructor(echo = true) {
    this.logs = [];
    this.echo = echo;
  }

  init(stagehand?: V3) {
    this.stagehand = stagehand;
  }

  log(logLine: LogLine) {
    if (!logToRow(toRowLogEntry(logLine)) && this.echo) {
      console.log(logLineToString(logLine));
    }
    this.logs.push(parseLogLine(logLine));
  }

  error(logLine: LogLine) {
    if (!logToRow(toRowLogEntry(logLine, 0)) && this.echo) {
      console.error(logLineToString(logLine));
    }
    this.logs.push(parseLogLine(logLine));
  }

  warn(logLine: LogLine) {
    if (!logToRow(toRowLogEntry(logLine)) && this.echo) {
      console.warn(logLineToString(logLine));
    }
    this.logs.push(parseLogLine(logLine));
  }

  getLogs(options: { maxLevel?: number } = {}): LogLineEval[] {
    const maxLevel = options.maxLevel ?? 1;
    return (this.logs || []).filter((line) => (line.level ?? 1) <= maxLevel);
  }

  clear(): void {
    this.logs = [];
    this.stagehand = undefined;
  }
}
