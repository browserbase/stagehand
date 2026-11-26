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

export type HarnessLogger = {
  log(line: LogLine): void;
  warn(line: LogLine): void;
  error(line: LogLine): void;
};

export class HarnessAdapterError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HarnessAdapterError";
  }
}
