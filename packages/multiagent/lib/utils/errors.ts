export class MultiagentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "MultiagentError";
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export class UnsupportedAdapterError extends MultiagentError {
  constructor(kind: string, name: string) {
    super(`${kind} "${name}" is not implemented yet.`);
    this.name = "UnsupportedAdapterError";
  }
}

export class CommandExecutionError extends MultiagentError {
  constructor(
    message: string,
    readonly details: {
      command: string;
      args: string[];
      exitCode?: number | null;
      stdout: string;
      stderr: string;
    },
  ) {
    super(message);
    this.name = "CommandExecutionError";
  }
}
