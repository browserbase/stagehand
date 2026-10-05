/**
 * mastracode eval driver. Runs in its own Node process, one per task:
 * reads a MastracodeDriverRequest from stdin, drives one headless mastracode
 * turn through mastracode's own SDK (`createMastraCode` + `runMC`, the same
 * path `mastracode --prompt` takes), and streams MastracodeDriverEvent JSONL
 * on stdout. stdout carries only protocol lines; console output goes to stderr.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  addTokenUsage,
  buildMastraCodeConfig,
  inspectModelRequest,
  isRecord,
  parseDriverRequest,
  parseProviderResponseUsage,
  sideModelIdFor,
  stringifyError,
  toTokenUsage,
  unexpectedTools,
} from "./config.js";
import {
  MASTRACODE_DEFAULT_STARTUP_TIMEOUT_MS,
  StartupTimeoutError,
  createStartupDeadline,
  watchParent,
} from "./lifecycle.js";
import {
  MASTRACODE_PROTOCOL_VERSION,
  type MastracodeDoneStatus,
  type MastracodeDriverEvent,
  type MastracodeDriverRequest,
  type MastracodeTokenUsage,
} from "./protocol.js";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type EventInput = DistributiveOmit<MastracodeDriverEvent, "v">;

const writeProtocolLine = process.stdout.write.bind(process.stdout);
function emit(event: EventInput): void {
  writeProtocolLine(`${JSON.stringify({ v: MASTRACODE_PROTOCOL_VERSION, ...event })}\n`);
}

// Libraries that print to stdout would corrupt the JSONL stream: route console output to stderr.
// oxlint-disable no-console -- rebinding console methods, not logging.
console.log = console.error.bind(console);
console.info = console.error.bind(console);
console.debug = console.error.bind(console);
// oxlint-enable no-console
process.stdout.write = ((chunk: unknown, ...rest: unknown[]) =>
  (process.stderr.write as (...args: unknown[]) => boolean)(
    chunk,
    ...rest,
  )) as typeof process.stdout.write;

process.on("unhandledRejection", (reason) => {
  process.stderr.write(`[mastracode-driver] unhandled rejection: ${stringifyError(reason)}\n`);
});

class ToolIsolationViolation extends Error {
  constructor(names: string[]) {
    super(`tool isolation violation: the model was offered ${names.join(", ")}`);
    this.name = "ToolIsolationViolation";
  }
}

interface RunHandle {
  abort(): void;
  result: Promise<{ status: string; error?: { message?: string } }>;
  [Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>>;
}

interface McpManagerLike {
  initInBackground(): Promise<unknown>;
  getTools(): Record<string, unknown> | undefined;
  disconnect(): unknown;
}

interface DriverState {
  request?: MastracodeDriverRequest;
  run?: RunHandle;
  mcpManager?: McpManagerLike;
  violation?: string;
  externallyAborted: boolean;
  steps: number;
  usageSum?: MastracodeTokenUsage;
  requests: number;
  pendingUsage: Set<Promise<void>>;
}

const state: DriverState = {
  externallyAborted: false,
  steps: 0,
  requests: 0,
  pendingUsage: new Set(),
};

function installFetchSpy(request: MastracodeDriverRequest): void {
  const originalFetch = globalThis.fetch;
  const spied: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const body = typeof init?.body === "string" ? init.body : undefined;
    const inspected = inspectModelRequest(url, body);
    if (inspected) {
      state.requests += 1;
      const index = state.requests;
      const role = inspected.toolNames.length > 0 ? "agent" : "side";
      emit({ type: "request", index, role, ...inspected });
      const unexpected = unexpectedTools(inspected.toolNames, request.facadeToolNames);
      if (unexpected.length > 0) {
        // Never let a contaminated request reach the model: fail it and end the run.
        emit({ type: "violation", kind: "unexpected_tool", names: unexpected });
        state.violation ??= `unexpected tools offered: ${unexpected.join(", ")}`;
        state.run?.abort();
        throw new ToolIsolationViolation(unexpected);
      }
      // Track the call from send to parsed usage, so `done` can wait for side
      // calls mastracode fires at the end of the run (thread title, observer).
      let settle!: () => void;
      const pending = new Promise<void>((resolve) => (settle = resolve));
      state.pendingUsage.add(pending);
      const release = () => {
        state.pendingUsage.delete(pending);
        settle();
      };
      let response: Response;
      try {
        response = await originalFetch(input, init);
      } catch (error) {
        release();
        throw error;
      }
      if (!response.ok) {
        release();
        return response;
      }
      // Tee the body so usage of every model call is visible, side calls included.
      response
        .clone()
        .text()
        .then((text) => {
          const usage = parseProviderResponseUsage(inspected.provider, text);
          if (usage) emit({ type: "request_usage", index, role, model: inspected.model, usage });
        })
        .catch(() => undefined)
        .finally(release);
      return response;
    }
    return originalFetch(input, init);
  };
  globalThis.fetch = spied;
}

function readVersions(): { mastracodeVersion?: string; codeSdkVersion?: string } {
  try {
    const require = createRequire(import.meta.url);
    const mastracodePkg = require.resolve("mastracode/package.json");
    const mastracodeVersion = readVersion(mastracodePkg);
    let codeSdkVersion: string | undefined;
    try {
      codeSdkVersion = readVersion(
        createRequire(mastracodePkg).resolve("@mastra/code-sdk/package.json"),
      );
    } catch {
      codeSdkVersion = undefined;
    }
    return { mastracodeVersion, codeSdkVersion };
  } catch {
    return {};
  }
}

function readVersion(pkgPath: string): string | undefined {
  const parsed: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
  return isRecord(parsed) && typeof parsed.version === "string" ? parsed.version : undefined;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function finishAndExit(event: Extract<EventInput, { type: "done" }>, code = 0): void {
  emit(event);
  writeProtocolLine("", () => process.exit(code));
}

async function main(): Promise<void> {
  const request = parseDriverRequest(await readStdin());
  state.request = request;
  // The parent already spawns with these; set them again before mastracode loads.
  process.env.MASTRA_APP_DATA_DIR = request.appDataDir;
  process.env.HOME = request.homeDir;
  process.env.MASTRA_TELEMETRY_DISABLED = "1";
  // Read by @mastra/code-sdk's constants at import time; backs up the
  // observer/reflector ids in initialState for any path that uses the default.
  process.env.DEFAULT_OM_MODEL_ID = sideModelIdFor(request);
  installFetchSpy(request);

  const versions = readVersions();
  const specifier = "mastracode";
  // runMC's timeout only starts once the run does; mastracode's MCP client
  // waits up to 7 days on connect/listTools. Bound startup separately.
  const startup = createStartupDeadline(
    request.startupTimeoutMs ?? MASTRACODE_DEFAULT_STARTUP_TIMEOUT_MS,
  );
  // Loaded by name at runtime: the evals build never type-checks or bundles mastracode.
  const mc = await startup("import", import(specifier));
  const booted = await startup(
    "createMastraCode",
    Promise.resolve(mc.createMastraCode(buildMastraCodeConfig(request))),
  );
  const { controller, session } = booted;
  const mcpManager = booted.mcpManager as McpManagerLike | undefined;
  state.mcpManager = mcpManager;

  if (mcpManager) await startup("mcp_connect", Promise.resolve(mcpManager.initInBackground()));
  const mcpTools = Object.keys(mcpManager?.getTools() ?? {});
  emit({ type: "ready", ...versions, mcpTools });
  const missing = request.facadeToolNames.filter((name) => !mcpTools.includes(name));
  if (missing.length > 0) {
    await withTimeout(Promise.resolve(mcpManager?.disconnect()), 5_000).catch(() => undefined);
    finishAndExit({
      type: "done",
      status: "error",
      stopReason: "mcp_unavailable",
      error: `MCP tools missing after startup: ${missing.join(", ")}`,
      finalText: "",
      steps: 0,
    });
    return;
  }

  await startup(
    "model_switch",
    Promise.resolve(session.model.switch({ modelId: request.modelId })),
  );
  if (request.thinkingLevel) {
    await startup(
      "thinking_level",
      Promise.resolve(session.state.set({ thinkingLevel: request.thinkingLevel })),
    );
  }
  if (state.externallyAborted) {
    await withTimeout(Promise.resolve(mcpManager?.disconnect()), 5_000).catch(() => undefined);
    finishAndExit({
      type: "done",
      status: "aborted",
      stopReason: "aborted",
      error: "mastracode driver aborted during startup",
      finalText: "",
      steps: 0,
    });
    return;
  }

  const run: RunHandle = mc.runMC({
    controller,
    session,
    prompt: request.prompt,
    ...(request.timeoutMs && request.timeoutMs > 0 && { timeoutMs: request.timeoutMs }),
    policy: mc.autoApprovePolicy,
  });
  state.run = run;
  if (state.violation || state.externallyAborted) run.abort();

  let budgetHit = false;
  let stepText = "";
  let stepHadToolCalls = false;
  let lastText = "";
  let prelude = "";
  let preludeKind: "text" | "reasoning" | undefined;
  let lastError: string | undefined;
  const appendPrelude = (delta: string, kind: "text" | "reasoning") => {
    prelude = prelude && preludeKind !== kind ? `${prelude}\n${delta}` : prelude + delta;
    preludeKind = kind;
  };

  for await (const event of run) {
    switch (event.type) {
      case "message_update": {
        const inner = isRecord(event.event) ? event.event : {};
        if (inner.type === "text-delta" && typeof inner.delta === "string") {
          stepText += inner.delta;
          appendPrelude(inner.delta, "text");
        } else if (inner.type === "reasoning-delta" && typeof inner.delta === "string") {
          appendPrelude(inner.delta, "reasoning");
        }
        break;
      }
      case "tool_start": {
        stepHadToolCalls = true;
        const reasoning = prelude.trim();
        emit({
          type: "tool_start",
          toolCallId: stringField(event.toolCallId),
          toolName: stringField(event.toolName),
          args: event.args,
          ...(reasoning && { reasoning }),
        });
        prelude = "";
        preludeKind = undefined;
        break;
      }
      case "tool_end": {
        emit({
          type: "tool_end",
          toolCallId: stringField(event.toolCallId),
          result: event.result,
          isError: event.isError === true,
          denied: event.denied === true,
        });
        break;
      }
      case "usage_update": {
        const usage = toTokenUsage(event.usage);
        if (!usage) break;
        state.steps += 1;
        state.usageSum = addTokenUsage(state.usageSum, usage);
        emit({
          type: "step",
          index: state.steps,
          usage,
          hadToolCalls: stepHadToolCalls,
          text: stepText,
        });
        if (stepText.trim()) lastText = stepText;
        // A step that called tools means the model wants another step; a
        // text-only step at the budget is the final answer and may finish.
        const overBudget =
          state.steps > request.stepBudget ||
          (state.steps === request.stepBudget && stepHadToolCalls);
        stepText = "";
        stepHadToolCalls = false;
        if (overBudget && !budgetHit) {
          budgetHit = true;
          run.abort();
        }
        break;
      }
      case "subagent_start": {
        emit({
          type: "violation",
          kind: "subagent",
          names: [stringField(event.agentType) || "subagent"],
        });
        state.violation ??= "subagent spawned";
        run.abort();
        break;
      }
      case "error": {
        lastError = isRecord(event.error)
          ? stringifyError(event.error.message ?? event.error)
          : stringifyError(event.error);
        break;
      }
      default:
        break;
    }
  }

  const result = await run.result;
  if (stepText.trim()) lastText = stepText;
  let status: MastracodeDoneStatus;
  let stopReason: string | undefined;
  if (state.violation) {
    status = "error";
    stopReason = "tool_isolation_violation";
  } else if (budgetHit && result.status !== "error" && result.status !== "timeout") {
    status = "max_turns";
  } else if (result.status === "completed" || result.status === "done") {
    status = "completed";
  } else if (result.status === "timeout") {
    status = "timeout";
    stopReason = "timeout";
  } else if (result.status === "aborted" || result.status === "max_turns") {
    status = "aborted";
    stopReason = "aborted";
  } else {
    status = "error";
    stopReason =
      result.error?.message ?? lastError ?? `mastracode run ended with status ${result.status}`;
  }

  let sessionTokenUsage: MastracodeTokenUsage | undefined;
  let thinkingLevel: string | undefined;
  try {
    sessionTokenUsage = toTokenUsage(session.getTokenUsage());
    const sessionState = session.state.get();
    if (isRecord(sessionState) && typeof sessionState.thinkingLevel === "string") {
      thinkingLevel = sessionState.thinkingLevel;
    }
  } catch {
    // Diagnostics only.
  }
  // mastracode starts some side calls only after the run settles (thread
  // title): give them a moment to start, then wait for every in-flight call.
  await new Promise((resolve) => setTimeout(resolve, 250));
  await withTimeout(Promise.allSettled(state.pendingUsage), 15_000);
  await withTimeout(Promise.resolve(mcpManager?.disconnect()), 5_000).catch(() => undefined);
  finishAndExit({
    type: "done",
    status,
    ...(stopReason && { stopReason }),
    finalText: lastText.trim(),
    steps: state.steps,
    ...(state.usageSum && { usageSum: state.usageSum }),
    ...(sessionTokenUsage && { sessionTokenUsage }),
    ...(thinkingLevel && { thinkingLevel }),
    ...((result.error?.message ?? lastError) && { error: result.error?.message ?? lastError }),
  });
}

/**
 * Stop the run on an outside signal: SIGTERM from the parent's process-group
 * kill, or the parent dying without one (SIGKILL, V8 heap OOM), which no
 * parent hook survives. Abort the model loop, drop the MCP children, then exit.
 */
function externalAbort(reason: string, exitCode: number): void {
  if (state.externallyAborted) return;
  state.externallyAborted = true;
  process.stderr.write(`[mastracode-driver] aborting: ${reason}\n`);
  state.run?.abort();
  void Promise.resolve()
    .then(() => state.mcpManager?.disconnect())
    .catch(() => undefined);
  setTimeout(() => {
    // With the parent gone nobody reaps our process group, and a wedged MCP
    // child may ignore stdin EOF. The driver leads its group when spawned
    // detached (the runner always does on POSIX); this kills the group, us included.
    if (process.platform !== "win32") {
      try {
        process.kill(-process.pid, "SIGKILL");
      } catch {
        // Not a group leader (spawned without detached): just exit.
      }
    }
    process.exit(exitCode);
  }, 1_500).unref();
}

process.on("SIGTERM", () => externalAbort("SIGTERM", 143));

// Nobody reads stdout once the parent is gone: writes fail with EPIPE.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") externalAbort("stdout closed (parent gone)", 129);
});

watchParent({
  originalPpid: process.ppid,
  onGone: () => externalAbort("parent process exited", 129),
});

main().catch((error: unknown) => {
  const message = stringifyError(error);
  process.stderr.write(
    `[mastracode-driver] ${error instanceof Error && error.stack ? error.stack : message}\n`,
  );
  const startupTimeout = error instanceof StartupTimeoutError;
  if (startupTimeout) {
    void Promise.resolve()
      .then(() => state.mcpManager?.disconnect())
      .catch(() => undefined);
  }
  finishAndExit(
    {
      type: "done",
      status: "error",
      stopReason: state.violation
        ? "tool_isolation_violation"
        : startupTimeout
          ? "startup_timeout"
          : message,
      error: message,
      finalText: "",
      steps: state.steps,
      ...(state.usageSum && { usageSum: state.usageSum }),
    },
    state.request ? 0 : 1,
  );
});
