import {
  browserbase,
  localBrowser,
  Stagehand,
  type Page,
  type StagehandBrowser,
  type StagehandMetrics,
} from "@browserbasehq/stagehand";
import { MAX_CODE_BYTES } from "./limits.js";
import { executeStagehandSnippet } from "./snippet.js";
import type {
  CodeExecuteFailure,
  CodeExecuteInput,
  CodeExecuteResult,
  CodeLogEntry,
  CodePageState,
  StagehandCodeConfig,
} from "./types.js";

export type StagehandCodeExecutorOptions = StagehandCodeConfig;

const MAX_LOG_BYTES = 64 * 1024;
const MAX_RESULT_BYTES = 256 * 1024;
const MAX_ERROR_MESSAGE_LENGTH = 4_000;
const MIN_SENSITIVE_VALUE_LENGTH = 8;
const SECRET_FIELD = /(?:api.?key|authorization|cookie|password|secret|token)/i;
const URL = /\b(?:https?|wss?):\/\/[^\s"'<>]+/gi;
const CREDENTIAL =
  /\b(authorization|api[_-]?key|password|secret|token)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi;
const BEARER_TOKEN = /\bbearer\s+[^\s,;]+/gi;

class StagehandCodeCloseError extends Error {
  override readonly name = "StagehandCodeCloseError";

  constructor() {
    super("Failed to close Stagehand code mode.");
  }
}

class StagehandCodeInitializationError extends Error {
  override readonly name = "StagehandCodeInitializationError";

  constructor() {
    super("Stagehand code mode initialization and browser cleanup both failed.");
  }
}

export class StagehandCodeExecutor {
  private stagehand?: Stagehand;
  private browser?: StagehandBrowser;
  private queue = Promise.resolve();
  private closed = false;
  private closePromise?: Promise<void>;
  private readonly sensitiveValues: string[];

  constructor(private readonly options: StagehandCodeExecutorOptions) {
    this.sensitiveValues = collectSensitiveValues(options);
  }

  execute(input: CodeExecuteInput, signal?: AbortSignal): Promise<CodeExecuteResult> {
    const validation = validate(input);
    if (validation) return Promise.resolve(validation);

    const operation = this.queue.then(() => this.executeQueued(input, signal));
    this.queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  metrics(): Promise<StagehandMetrics | undefined> {
    const operation = this.queue.then(() => this.stagehand?.metrics());
    this.queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  close(): Promise<void> {
    this.closed = true;
    this.closePromise ??= this.queue.then(async () => {
      const stagehand = this.stagehand;
      const browser = this.browser;
      this.stagehand = undefined;
      this.browser = undefined;

      let failed = false;
      if (stagehand) {
        await stagehand.close().catch(() => {
          failed = true;
        });
      }
      if (browser) {
        await browser.close().catch(() => {
          failed = true;
        });
      }
      if (failed) throw new StagehandCodeCloseError();
    });
    return this.closePromise;
  }

  private async executeQueued(
    input: CodeExecuteInput,
    signal?: AbortSignal,
  ): Promise<CodeExecuteResult> {
    if (this.closed) {
      return failure("closed", "Code executor is closed.");
    }
    if (signal?.aborted) {
      return failure("aborted", "Code execution was aborted before it began.");
    }

    const logs: CodeLogEntry[] = [];
    let page: Page | undefined;
    try {
      const stagehand = await this.ensureStagehand();
      const context = stagehand.browser.context;
      page =
        (await context.activePage()) ?? (await context.pages())[0] ?? (await context.newPage());

      if (signal?.aborted) {
        return failure("aborted", "Code execution was aborted before it began.", "CodeModeError", {
          page: await readPageState(page),
        });
      }

      const value = await executeStagehandSnippet({
        code: input.code,
        page,
        context,
        stagehand,
        console: createCodeConsole(logs),
      });
      const currentPage = (await context.activePage()) ?? page;

      return {
        ok: true,
        page: await readPageState(currentPage),
        ...(value === undefined ? {} : { value: jsonSafe(value) }),
        ...(logs.length === 0 ? {} : { logs }),
      };
    } catch (error) {
      const normalized = normalizeError(error, this.sensitiveValues);
      const currentPage = (await this.activePage().catch(() => undefined)) ?? page;
      return failure("runtime", normalized.message, normalized.name, {
        ...(currentPage ? { page: await readPageState(currentPage).catch(() => undefined) } : {}),
        ...(logs.length === 0 ? {} : { logs }),
      });
    }
  }

  private async ensureStagehand(): Promise<Stagehand> {
    if (this.stagehand) return this.stagehand;

    const browserConfig = this.options.browser;
    const browser =
      browserConfig.type === "browserbase"
        ? await browserbase.launch(browserConfig.launchOptions)
        : await localBrowser.launch(browserConfig.launchOptions);

    try {
      const stagehand = await Stagehand.create({
        browser,
        logging: { level: "off" },
        ...this.options.stagehand,
      });
      this.browser = browser;
      this.stagehand = stagehand;
      return stagehand;
    } catch (error) {
      try {
        await browser.close();
      } catch {
        throw new StagehandCodeInitializationError();
      }
      throw error;
    }
  }

  private async activePage(): Promise<Page | undefined> {
    if (!this.stagehand) return undefined;
    return (
      (await this.stagehand.browser.context.activePage()) ??
      (await this.stagehand.browser.context.pages())[0]
    );
  }
}

function validate(input: CodeExecuteInput): CodeExecuteFailure | undefined {
  if (!input || typeof input.code !== "string" || input.code.trim().length === 0) {
    return failure("validation", "code must be a non-empty JavaScript function body.");
  }
  if (Buffer.byteLength(input.code) > MAX_CODE_BYTES) {
    return failure("validation", `code must be at most ${MAX_CODE_BYTES} UTF-8 bytes.`);
  }
  return undefined;
}

function createCodeConsole(logs: CodeLogEntry[]) {
  let logBytes = 0;
  const append = (level: CodeLogEntry["level"], values: unknown[]) => {
    if (logBytes >= MAX_LOG_BYTES) return;
    const text = formatLog(values);
    const remaining = MAX_LOG_BYTES - logBytes;
    const bounded = truncateUtf8(text, remaining);
    if (bounded.length === 0) {
      if (text.length > 0) logBytes = MAX_LOG_BYTES;
      return;
    }
    logBytes += Buffer.byteLength(bounded);
    logs.push({ level, text: bounded });
  };
  return Object.freeze({
    log: (...values: unknown[]) => append("log", values),
    warn: (...values: unknown[]) => append("warn", values),
    error: (...values: unknown[]) => append("error", values),
  });
}

async function readPageState(page: Page): Promise<CodePageState> {
  const [url, title] = await Promise.all([page.url(), page.title()]);
  return { url, title };
}

function jsonSafe(value: unknown): unknown {
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(value, (_key, nested) => {
    if (typeof nested === "bigint") return nested.toString();
    if (nested instanceof Uint8Array) {
      return {
        type: "bytes",
        encoding: "base64",
        data: Buffer.from(nested).toString("base64"),
      };
    }
    return nested;
  });
  if (serialized === undefined) return undefined;
  const bytes = Buffer.byteLength(serialized);
  if (bytes <= MAX_RESULT_BYTES) return JSON.parse(serialized);
  return {
    truncated: true,
    original_bytes: bytes,
    preview: truncateUtf8(serialized, MAX_RESULT_BYTES),
  };
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (Buffer.byteLength(value) <= maxBytes) return value;

  const characters: string[] = [];
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character);
    if (bytes + characterBytes > maxBytes) break;
    characters.push(character);
    bytes += characterBytes;
  }
  return characters.join("");
}

function formatLog(values: unknown[]): string {
  return values
    .map((value) => {
      if (typeof value === "string") return value;
      try {
        const safe = jsonSafe(value);
        return safe === undefined ? String(value) : JSON.stringify(safe);
      } catch {
        return "[Unserializable value]";
      }
    })
    .join(" ");
}

function normalizeError(
  error: unknown,
  sensitiveValues: string[],
): { name: string; message: string } {
  if (!(error instanceof Error)) {
    return { name: "Error", message: "Code execution failed with a non-Error value." };
  }

  const safeName = /^[A-Za-z_$][A-Za-z0-9_$.-]{0,99}$/.test(error.name) ? error.name : "Error";
  return {
    name: safeName,
    message: sanitizeErrorMessage(error.message, sensitiveValues),
  };
}

function sanitizeErrorMessage(message: string, sensitiveValues: string[]): string {
  let sanitized = message;
  // Remove complete configured secrets before pattern redaction and final truncation.
  for (const sensitiveValue of sensitiveValues) {
    sanitized = sanitized.replaceAll(sensitiveValue, "[REDACTED]");
  }
  sanitized = sanitized
    .replace(URL, "[REDACTED_URL]")
    .replace(CREDENTIAL, "$1=[REDACTED]")
    .replace(BEARER_TOKEN, "Bearer [REDACTED]");
  return sanitized.slice(0, MAX_ERROR_MESSAGE_LENGTH) || "Code execution failed.";
}

function collectSensitiveValues(value: unknown): string[] {
  const values = new Set<string>();
  const seen = new WeakMap<object, boolean>();

  const visit = (current: unknown, key = "", parentIsSensitive = false) => {
    const isSensitive = parentIsSensitive || SECRET_FIELD.test(key);
    if (typeof current === "string") {
      if (isSensitive && current.length >= MIN_SENSITIVE_VALUE_LENGTH) values.add(current);
      return;
    }
    if (!current || typeof current !== "object") return;
    const previousSensitivity = seen.get(current);
    if (previousSensitivity === true || (previousSensitivity === false && !isSensitive)) return;
    seen.set(current, isSensitive);
    for (const [nestedKey, nestedValue] of Object.entries(current)) {
      visit(nestedValue, nestedKey, isSensitive);
    }
  };

  visit(value);
  return [...values].sort((left, right) => right.length - left.length);
}

function failure(
  kind: CodeExecuteFailure["error"]["kind"],
  message: string,
  name = "CodeModeError",
  evidence: Pick<CodeExecuteFailure, "page" | "logs"> = {},
): CodeExecuteFailure {
  return {
    ok: false,
    ...evidence,
    error: { kind, name, message },
  };
}
