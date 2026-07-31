export const CODE_EXECUTE_ACTIONS = ["run", "status", "reset", "close"] as const;

export type CodeExecuteAction = (typeof CODE_EXECUTE_ACTIONS)[number];

export type CodeExecuteInput = {
  action: CodeExecuteAction;
  code_session_id?: string;
  code?: string;
  timeout_ms?: number;
};

export type CodeSessionState = "idle" | "running" | "ready" | "closed";

export type CodePageState = {
  url: string;
  title: string;
};

export type CodeLogEntry = {
  level: "log" | "warn" | "error";
  text: string;
};

export type CodeExecuteErrorKind =
  | "validation"
  | "session_not_found"
  | "runtime"
  | "timeout"
  | "aborted"
  | "closed";

export type CodeExecuteError = {
  kind: CodeExecuteErrorKind;
  name: string;
  message: string;
  retryable: boolean;
  may_have_side_effects?: boolean;
};

export type CodeExecuteSuccess = {
  ok: true;
  action: CodeExecuteAction;
  code_session_id?: string;
  state: CodeSessionState;
  page?: CodePageState;
  value?: unknown;
  logs?: CodeLogEntry[];
  active_code_sessions?: number;
};

export type CodeExecuteFailure = {
  ok: false;
  action: CodeExecuteAction;
  code_session_id?: string;
  state?: CodeSessionState;
  page?: CodePageState;
  error: CodeExecuteError;
};

export type CodeExecuteResult = CodeExecuteSuccess | CodeExecuteFailure;

export type RuntimeRunResult = {
  value?: unknown;
  logs: CodeLogEntry[];
  page: CodePageState;
};

export type RuntimeStatus = {
  state: Exclude<CodeSessionState, "closed">;
  page?: CodePageState;
};

export interface CodeRuntime {
  run(code: string, timeoutMs: number, signal?: AbortSignal): Promise<RuntimeRunResult>;
  status(signal?: AbortSignal): Promise<RuntimeStatus>;
  reset(signal?: AbortSignal): Promise<void>;
  close(): Promise<void>;
}

export type StagehandCodeRuntimeConfig = {
  browserbaseApiKey?: string;
  model?: {
    modelName: string;
    apiKey?: string;
    baseURL?: string;
  };
  defaultTimeoutMs?: number;
};

export class CodeModeRuntimeError extends Error {
  readonly mayHaveSideEffects: boolean;

  constructor(
    readonly kind: CodeExecuteErrorKind,
    message: string,
    readonly retryable = false,
    options?: ErrorOptions & { mayHaveSideEffects?: boolean },
  ) {
    super(message, options);
    this.name = "CodeModeRuntimeError";
    this.mayHaveSideEffects = options?.mayHaveSideEffects ?? false;
  }
}
