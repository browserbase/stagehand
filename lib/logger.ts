import pino from "pino";
import { LogLine } from "../types/log";

// Map our existing levels to Pino's standard levels
const levelMapping: Record<number, pino.Level> = {
  0: "error", // Critical/important messages
  1: "info", // Standard information
  2: "debug", // Detailed debugging information
};

// Define configuration options
export interface LoggerOptions {
  pretty?: boolean;
  level?: pino.Level;
  destination?: pino.DestinationStream;
  usePino?: boolean; // Whether to use pino (default: true)
}

/**
 * Creates a configured Pino logger instance
 */
export function createLogger(options: LoggerOptions = {}) {
  const loggerConfig: pino.LoggerOptions = {
    level: options.level || "info",
    base: undefined, // Don't include pid and hostname
    browser: {
      asObject: true,
    },
    // Disable worker threads to avoid issues in tests
    transport: undefined,
  };

  // Add pretty printing for dev environments only if explicitly requested
  // and not in a test environment
  if (options.pretty && !isTestEnvironment()) {
    try {
      // Use require for dynamic import
      const transport = {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      };
      Object.assign(loggerConfig, transport);
    } catch {
      console.warn(
        "pino-pretty not available, falling back to standard logging",
      );
    }
  }

  return pino(loggerConfig, options.destination);
}

/**
 * Check if we're running in a test environment
 */
function isTestEnvironment(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.JEST_WORKER_ID !== undefined ||
    process.env.PLAYWRIGHT_TEST_BASE_DIR !== undefined ||
    // Check if we're in a CI environment
    process.env.CI === "true"
  );
}

/**
 * StagehandLogger class that wraps Pino for our specific needs
 */
export class StagehandLogger {
  /**
   * We maintain a single shared Pino instance when `usePino` is enabled.
   * This prevents spawning a new worker thread for every Stagehand instance
   * (which happens when `pino-pretty` transport is used), eliminating the
   * memory/RSS growth observed when many Stagehand objects are created and
   * disposed within the same process (e.g. a request-per-instance API).
   */
  private static sharedPinoLogger: pino.Logger | null = null;

  private logger?: pino.Logger;
  private verbose: 0 | 1 | 2;
  private externalLogger?: (logLine: LogLine) => void;
  private usePino: boolean;
  private isTest: boolean;

  constructor(
    options: LoggerOptions = {},
    externalLogger?: (logLine: LogLine) => void,
  ) {
    this.isTest = isTestEnvironment();

    // In test environments, default to not using Pino to avoid worker thread issues
    this.usePino = this.isTest ? false : options.usePino !== false; // Default to using Pino if not specified and not in test

    if (this.usePino) {
      // Re-use (or create) a single shared Pino logger instance
      if (!StagehandLogger.sharedPinoLogger) {
        StagehandLogger.sharedPinoLogger = createLogger(options);
      }
      this.logger = StagehandLogger.sharedPinoLogger;
    }

    this.verbose = 1; // Default verbosity level
    this.externalLogger = externalLogger;
  }

  /**
   * Set the verbosity level
   */
  setVerbosity(level: 0 | 1 | 2) {
    this.verbose = level;

    if (this.usePino && this.logger) {
      // Map our verbosity levels to Pino log levels
      switch (level) {
        case 0:
          this.logger.level = "error";
          break;
        case 1:
          this.logger.level = "info";
          break;
        case 2:
          this.logger.level = "debug";
          break;
      }
    }
  }

  /**
   * Log a message using our LogLine format
   */
  log(logLine: LogLine): void {
    // Skip logs above verbosity level
    if ((logLine.level ?? 1) > this.verbose) {
      return;
    }

    // For test environments WITHOUT an external logger OR for cases where Pino
    // is disabled and no external logger is provided, fall back to console.* so
    // users still see logs (non-colourised).
    const shouldFallbackToConsole =
      (!this.usePino && !this.externalLogger) ||
      (this.isTest && !this.externalLogger);

    if (shouldFallbackToConsole) {
      const level = logLine.level ?? 1;
      const prefix = `[${logLine.category || "log"}] `;

      switch (level) {
        case 0:
          console.error(prefix + logLine.message);
          break;
        case 1:
          console.log(prefix + logLine.message);
          break;
        case 2:
          console.debug(prefix + logLine.message);
          break;
      }

      return; // already handled via console output, avoid duplicate logging
    }

    if (this.usePino && this.logger) {
      // Determine the Pino log level
      const pinoLevel = levelMapping[logLine.level ?? 1] || "info";

      // Structure the log data
      const logData = {
        category: logLine.category,
        timestamp: logLine.timestamp || new Date().toISOString(),
        ...this.formatAuxiliaryData(logLine.auxiliary),
      };

      // Log through Pino with the appropriate level
      if (pinoLevel === "error") {
        this.logger.error(logData, logLine.message);
      } else if (pinoLevel === "info") {
        this.logger.info(logData, logLine.message);
      } else if (pinoLevel === "debug") {
        this.logger.debug(logData, logLine.message);
      } else if (pinoLevel === "warn") {
        this.logger.warn(logData, logLine.message);
      } else if (pinoLevel === "trace") {
        this.logger.trace(logData, logLine.message);
      } else {
        this.logger.info(logData, logLine.message);
      }
    }

    // Use external logger if provided and either Pino is disabled or we're in a test
    if (this.externalLogger && (!this.usePino || this.isTest)) {
      this.externalLogger(logLine);
    }
  }

  /**
   * Helper to format auxiliary data for structured logging
   */
  private formatAuxiliaryData(auxiliary?: LogLine["auxiliary"]) {
    if (!auxiliary) return {};

    const formattedData: Record<string, unknown> = {};

    for (const [key, { value, type }] of Object.entries(auxiliary)) {
      // Convert values based on their type
      switch (type) {
        case "integer":
          formattedData[key] = parseInt(value, 10);
          break;
        case "float":
          formattedData[key] = parseFloat(value);
          break;
        case "boolean":
          formattedData[key] = value === "true";
          break;
        case "object":
          try {
            formattedData[key] = JSON.parse(value);
          } catch {
            formattedData[key] = value;
          }
          break;
        default:
          formattedData[key] = value;
      }
    }

    return formattedData;
  }

  /**
   * Convenience methods for different log levels
   */
  error(message: string, data?: Record<string, unknown>): void {
    this.log({
      message,
      level: 0,
      auxiliary: this.convertToAuxiliary(data),
    });
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log({
      message,
      level: 1,
      category: "warning",
      auxiliary: this.convertToAuxiliary(data),
    });
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log({
      message,
      level: 1,
      auxiliary: this.convertToAuxiliary(data),
    });
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log({
      message,
      level: 2,
      auxiliary: this.convertToAuxiliary(data),
    });
  }

  /**
   * Convert a plain object to our auxiliary format
   */
  private convertToAuxiliary(
    data?: Record<string, unknown>,
  ): LogLine["auxiliary"] {
    if (!data) return undefined;

    const auxiliary: LogLine["auxiliary"] = {};

    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;

      const type = typeof value;

      auxiliary[key] = {
        value: type === "object" ? JSON.stringify(value) : String(value),
        type:
          type === "number"
            ? Number.isInteger(value)
              ? "integer"
              : "float"
            : type === "boolean"
              ? "boolean"
              : type === "object"
                ? "object"
                : "string",
      };
    }

    return auxiliary;
  }
}
