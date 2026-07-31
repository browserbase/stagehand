import { randomUUID } from "node:crypto";
import type {
  CodeExecuteFailure,
  CodeExecuteInput,
  CodeExecuteResult,
  CodeExecuteSuccess,
  CodePageState,
  CodeRuntime,
  CodeSessionState,
  RuntimeStatus,
} from "./types.js";
import { CodeModeRuntimeError } from "./types.js";

type ManagedSession = {
  id: string;
  runtime?: CodeRuntime;
  queue: Promise<void>;
  state: Exclude<CodeSessionState, "closed">;
  page?: CodePageState;
};

export type CodeRuntimeFactory = (codeSessionId: string) => CodeRuntime;

export type CodeSessionManagerOptions = {
  runtimeFactory: CodeRuntimeFactory;
  defaultTimeoutMs?: number;
  sessionIdFactory?: () => string;
};

const DEFAULT_TIMEOUT_MS = 120_000;

export class CodeSessionManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly defaultTimeoutMs: number;
  private readonly sessionIdFactory: () => string;
  private closeAllPromise?: Promise<void>;

  constructor(private readonly options: CodeSessionManagerOptions) {
    this.defaultTimeoutMs = requirePositiveTimeout(
      options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      "defaultTimeoutMs",
    );
    this.sessionIdFactory =
      options.sessionIdFactory ?? (() => `code_${randomUUID().replaceAll("-", "")}`);
  }

  async execute(input: CodeExecuteInput, signal?: AbortSignal): Promise<CodeExecuteResult> {
    const validationError = validateInput(input);
    if (validationError) return failure(input, "validation", validationError);

    if (input.action === "status" && input.code_session_id === undefined) {
      return {
        ok: true,
        action: "status",
        state: "idle",
        active_code_sessions: this.sessions.size,
      };
    }

    if (input.action === "run") {
      const created = input.code_session_id === undefined;
      const session = created ? this.createSession() : this.sessions.get(input.code_session_id!);
      if (!session) return sessionNotFound(input);
      const result = await this.enqueue(session, input, signal, () =>
        this.run(session, input, signal),
      );
      if (created && !result.ok && result.error.kind === "aborted") {
        await session.runtime?.close().catch(() => undefined);
        this.sessions.delete(session.id);
      }
      return result;
    }

    const session = this.sessions.get(input.code_session_id!);
    if (!session) return sessionNotFound(input);

    return this.enqueue(session, input, signal, async () => {
      switch (input.action) {
        case "status":
          return this.status(session, signal);
        case "reset":
          return this.reset(session, signal);
        case "close":
          return this.close(session);
        case "run":
          throw new Error("run is handled before session lookup");
      }
    });
  }

  async closeAll(): Promise<void> {
    this.closeAllPromise ??= (async () => {
      const sessions = [...this.sessions.values()];
      await Promise.all(sessions.map((session) => this.close(session)));
    })();
    return this.closeAllPromise;
  }

  get activeSessionCount(): number {
    return this.sessions.size;
  }

  private createSession(): ManagedSession {
    const id = this.sessionIdFactory();
    if (this.sessions.has(id)) {
      throw new Error(`Code session ID factory returned a duplicate ID: ${id}`);
    }
    const session: ManagedSession = {
      id,
      queue: Promise.resolve(),
      state: "idle",
    };
    this.sessions.set(id, session);
    return session;
  }

  private async run(
    session: ManagedSession,
    input: CodeExecuteInput,
    signal?: AbortSignal,
  ): Promise<CodeExecuteSuccess> {
    throwIfAborted(signal);
    const runtime = (session.runtime ??= this.options.runtimeFactory(session.id));
    session.state = "running";
    try {
      const result = await runtime.run(
        input.code!,
        requirePositiveTimeout(input.timeout_ms ?? this.defaultTimeoutMs, "timeout_ms"),
        signal,
      );
      session.state = "ready";
      session.page = result.page;
      return {
        ok: true,
        action: "run",
        code_session_id: session.id,
        state: session.state,
        page: result.page,
        ...(result.value === undefined ? {} : { value: result.value }),
        ...(result.logs.length === 0 ? {} : { logs: result.logs }),
      };
    } catch (error) {
      session.state = "idle";
      throw error;
    }
  }

  private async status(session: ManagedSession, signal?: AbortSignal): Promise<CodeExecuteSuccess> {
    throwIfAborted(signal);
    let runtimeStatus: RuntimeStatus | undefined;
    if (session.runtime) {
      runtimeStatus = await session.runtime.status(signal);
      session.state = runtimeStatus.state;
      session.page = runtimeStatus.page;
    }
    return {
      ok: true,
      action: "status",
      code_session_id: session.id,
      state: session.state,
      ...(session.page ? { page: session.page } : {}),
    };
  }

  private async reset(session: ManagedSession, signal?: AbortSignal): Promise<CodeExecuteSuccess> {
    throwIfAborted(signal);
    await session.runtime?.reset(signal);
    session.state = "idle";
    session.page = undefined;
    return {
      ok: true,
      action: "reset",
      code_session_id: session.id,
      state: "idle",
    };
  }

  private async close(session: ManagedSession): Promise<CodeExecuteSuccess> {
    try {
      await session.runtime?.close();
    } finally {
      session.state = "idle";
      session.page = undefined;
      this.sessions.delete(session.id);
    }
    return {
      ok: true,
      action: "close",
      code_session_id: session.id,
      state: "closed",
    };
  }

  private async enqueue(
    session: ManagedSession,
    input: CodeExecuteInput,
    signal: AbortSignal | undefined,
    operation: () => Promise<CodeExecuteSuccess>,
  ): Promise<CodeExecuteResult> {
    const pending = session.queue.then(async () => {
      try {
        throwIfAborted(signal);
        return await operation();
      } catch (error) {
        return failureFromError(input, session, error);
      }
    });
    session.queue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }
}

function validateInput(input: CodeExecuteInput): string | undefined {
  if (input.action === "run" && (!input.code || input.code.trim().length === 0)) {
    return "action=run requires a non-empty code string.";
  }
  if (
    (input.action === "reset" || input.action === "close") &&
    input.code_session_id === undefined
  ) {
    return `action=${input.action} requires code_session_id.`;
  }
  if (input.code_session_id !== undefined && input.code_session_id.trim().length === 0) {
    return "code_session_id must be a non-empty opaque identifier.";
  }
  if (
    input.timeout_ms !== undefined &&
    (!Number.isSafeInteger(input.timeout_ms) || input.timeout_ms <= 0)
  ) {
    return "timeout_ms must be a positive integer.";
  }
  return undefined;
}

function sessionNotFound(input: CodeExecuteInput): CodeExecuteFailure {
  return failure(
    input,
    "session_not_found",
    `Code session ${input.code_session_id} was not found or is already closed.`,
  );
}

function failure(
  input: Pick<CodeExecuteInput, "action" | "code_session_id">,
  kind: CodeExecuteFailure["error"]["kind"],
  message: string,
): CodeExecuteFailure {
  return {
    ok: false,
    action: input.action,
    ...(input.code_session_id ? { code_session_id: input.code_session_id } : {}),
    error: {
      kind,
      name: "CodeModeRuntimeError",
      message,
      retryable: kind === "timeout" || kind === "runtime",
    },
  };
}

function failureFromError(
  input: CodeExecuteInput,
  session: ManagedSession,
  error: unknown,
): CodeExecuteFailure {
  const normalized =
    error instanceof Error ? error : new Error(typeof error === "string" ? error : String(error));
  const kind = error instanceof CodeModeRuntimeError ? error.kind : "runtime";
  return {
    ok: false,
    action: input.action,
    code_session_id: session.id,
    state: session.state,
    ...(session.page ? { page: session.page } : {}),
    error: {
      kind,
      name: normalized.name,
      message: normalized.message,
      retryable:
        error instanceof CodeModeRuntimeError
          ? error.retryable
          : kind === "runtime" || kind === "timeout",
      ...(error instanceof CodeModeRuntimeError && error.mayHaveSideEffects
        ? { may_have_side_effects: true }
        : {}),
    },
  };
}

function requirePositiveTimeout(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new CodeModeRuntimeError("aborted", "Code execution was aborted.", false, {
      cause: signal.reason,
    });
  }
}

export function codeExecuteResultText(result: CodeExecuteResult): string {
  return JSON.stringify(result, null, 2);
}
