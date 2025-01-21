/**
 * This file defines the `EvalLogger` class, which is used to capture and manage
 * log lines during the evaluation process. The logger supports different log
 * levels (info, error, warn), stores logs in memory for later retrieval, and
 * also prints them to the console for immediate feedback.
 *
 * The `parseLogLine` function helps transform raw `LogLine` objects into a more
 * structured format (`LogLineEval`), making auxiliary data easier to understand
 * and analyze. By associating an `EvalLogger` instance with a `Stagehand` object,
 * all logs emitted during the evaluation process can be captured, persisted, and
 * reviewed after the tasks complete.
 */
import { logLineToString } from "./utils";
import { LogLineEval } from "@/types/evals";
import { Stagehand, LogLine } from "@/dist";

/**
 * parseLogLine:
 * Given a LogLine, attempts to parse its `auxiliary` field into a structured object.
 * If parsing fails, logs an error and returns the original line.
 *
 * The `auxiliary` field in the log line typically contains additional metadata about the log event.
 */
function parseLogLine(logLine: LogLine): LogLineEval {
  try {
    return {
      ...logLine,
      // Remove the original auxiliary field in favor of parsedAuxiliary
      auxiliary: undefined,
      parsedAuxiliary: logLine.auxiliary
        ? Object.fromEntries(
            Object.entries(logLine.auxiliary).map(([key, entry]) => [
              key,
              entry.type === "object" ? JSON.parse(entry.value) : entry.value,
            ]),
          )
        : undefined,
    } as LogLineEval;
  } catch (e) {
    console.log("Error parsing log line", logLine);
    console.error(e);
    return logLine;
  }
}

/**
 * EvalLogger:
 * A logger class used during evaluations to capture and print log lines.
 *
 * Capabilities:
 * - Maintains an internal array of log lines (EvalLogger.logs) for later retrieval.
 * - Can be initialized with a Stagehand instance to provide consistent logging.
 * - Supports logging at different levels (info, error, warn).
 * - Each log line is converted to a string and printed to console for immediate feedback.
 * - Also keeps a structured version of the logs that can be returned for analysis or
 *   included in evaluation output.
 */
export class EvalLogger {
  logs: LogLineEval[] = [];
  stagehand?: Stagehand;

  constructor() {}

  /**
   * init:
   * Associates this logger with a given Stagehand instance.
   * This allows the logger to provide additional context if needed.
   */
  init(stagehand: Stagehand) {
    this.stagehand = stagehand;
  }

  /**
   * log:
   * Logs a message at the default (info) level.
   * Uses `logLineToString` to produce a readable output on the console,
   * and then stores the parsed log line in `this.logs`.
   */
  log(logLine: LogLine) {
    console.log(logLineToString(logLine));
    this.logs.push(parseLogLine(logLine));
  }

  /**
   * error:
   * Logs an error message with `console.error` and stores it.
   * Useful for capturing and differentiating error-level logs.
   */
  error(logLine: LogLine) {
    console.error(logLineToString(logLine));
    this.logs.push(parseLogLine(logLine));
  }

  /**
   * warn:
   * Logs a warning message with `console.warn` and stores it.
   * Helps differentiate warnings from regular info logs.
   */
  warn(logLine: LogLine) {
    console.warn(logLineToString(logLine));
    this.logs.push(parseLogLine(logLine));
  }

  /**
   * getLogs:
   * Retrieves the array of stored log lines.
   * Useful for returning logs after a task completes, for analysis or debugging.
   */
  getLogs() {
    return this.logs;
  }
}
