export type LogLevel = 0 | 1 | 2;

/**
 * Mapping between numeric log levels and their names
 *
 * 0 - error/warn - Critical issues or important warnings
 * 1 - info - Standard information messages
 * 2 - debug - Detailed information for debugging
 */
export const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  0: "error",
  1: "info",
  2: "debug",
};

export type LogLine = {
  id?: string;
  category?: string;
  message: string;
  level?: LogLevel;
  timestamp?: string;
  auxiliary?: {
    [key: string]: {
      value: string;
      type: "object" | "string" | "html" | "integer" | "float" | "boolean";
    };
  };
};

export type Logger = (logLine: LogLine) => void;
