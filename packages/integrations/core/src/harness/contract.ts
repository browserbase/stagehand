type LogLine = {
  id?: string;
  category?: string;
  message: string;
  level?: 0 | 1 | 2;
  timestamp?: string;
  auxiliary?: Record<
    string,
    {
      value: string;
      type: "object" | "string" | "html" | "integer" | "float" | "boolean";
    }
  >;
};

/** Logger surface required by agent harness adapters. */
export type HarnessLogger = {
  log(line: LogLine): void;
  warn(line: LogLine): void;
  error(line: LogLine): void;
};

/** Error raised when a harness adapter cannot complete its work. */
export class HarnessAdapterError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HarnessAdapterError";
  }
}
