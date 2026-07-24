/**
 * Parent side of --isolate: run one bench task in a child process so a hard
 * crash (OOM, hung SDK, unhandled rejection) fails that task alone instead
 * of taking down the whole suite.
 *
 * The child is `tsx framework/benchTaskWorker.ts` spawned from the repo
 * root (the SDK ships raw .ts, and repo-root cwd keeps tsx away from the
 * evals tsconfig paths — see the CLI invocation notes in the README). The
 * payload travels over stdin; the result comes back as a sentinel-framed
 * JSON line on stdout. On any non-sentinel outcome the parent synthesizes a
 * failed TaskResult carrying the exit reason and the tail of stderr.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { getRepoRootDir } from "../runtimePaths.js";
import { hasBraintrustApiKey, loadBraintrust } from "./braintrust.js";
import type { EvalInput } from "../types/evals.js";
import type { DiscoveredTask, TaskResult } from "./types.js";
import type { RunEvalsOptions } from "./runner.js";

export const TASK_RESULT_SENTINEL = "__STAGEHAND_EVAL_TASK_RESULT__:";

/** JSON-serializable subset of RunEvalsOptions a task execution reads. */
export type IsolatedTaskOptions = Pick<
  RunEvalsOptions,
  | "trials"
  | "environment"
  | "useApi"
  | "modelOverride"
  | "provider"
  | "categoryFilter"
  | "datasetFilter"
  | "agentMode"
  | "agentModes"
  | "harness"
  | "sdk"
  | "coreToolSurface"
  | "coreStartupProfile"
  | "verbose"
>;

export interface IsolatedTaskPayload {
  input: EvalInput;
  task: DiscoveredTask;
  options: IsolatedTaskOptions;
  /**
   * Exported Braintrust span of the parent row, so the child's spans
   * (verifier.verify etc.) attach to the same trace instead of being lost
   * at the process boundary. Absent when Braintrust logging is off.
   */
  braintrustParent?: string;
}

/** Hard cap per task process; generous next to in-task timeouts.
 * Override with EVAL_ISOLATE_TIMEOUT_MS (also how the kill path is
 * exercised in verification). */
const TASK_PROCESS_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.EVAL_ISOLATE_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15 * 60 * 1000;
})();
const STDERR_TAIL_CHARS = 2000;

function serializableOptions(options: RunEvalsOptions): IsolatedTaskOptions {
  return {
    trials: options.trials,
    environment: options.environment,
    useApi: options.useApi,
    modelOverride: options.modelOverride,
    provider: options.provider,
    categoryFilter: options.categoryFilter,
    datasetFilter: options.datasetFilter,
    agentMode: options.agentMode,
    agentModes: options.agentModes,
    harness: options.harness,
    sdk: options.sdk,
    // Tool-surface selection must cross the boundary or isolated
    // external-harness runs silently fall back to browse_cli.
    coreToolSurface: options.coreToolSurface,
    coreStartupProfile: options.coreStartupProfile,
    verbose: options.verbose,
  };
}

function resolveWorkerInvocation(repoRoot: string): {
  command: string;
  args: string[];
} {
  const workerPath = path.join(
    repoRoot,
    "packages/evals/framework/benchTaskWorker.ts",
  );
  const localTsx = path.join(repoRoot, "node_modules/.bin/tsx");
  if (existsSync(localTsx)) {
    return { command: localTsx, args: [workerPath] };
  }
  return { command: "npx", args: ["tsx", workerPath] };
}

export async function executeBenchTaskIsolated(
  input: EvalInput,
  task: DiscoveredTask,
  options: RunEvalsOptions,
): Promise<TaskResult> {
  const repoRoot = getRepoRootDir();
  const { command, args } = resolveWorkerInvocation(repoRoot);

  // Distributed tracing across the process boundary (best-effort): export
  // the current row span so the child can re-enter the trace.
  let braintrustParent: string | undefined;
  if (hasBraintrustApiKey()) {
    try {
      const bt = await loadBraintrust();
      braintrustParent = await bt.currentSpan().export();
    } catch {
      // tracing is additive - never block execution on it
    }
  }

  const payload: IsolatedTaskPayload = {
    input,
    task,
    options: serializableOptions(options),
    ...(braintrustParent && { braintrustParent }),
  };

  return new Promise<TaskResult>((resolve) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderrTail = "";
    let settled = false;

    const settle = (result: TaskResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };

    const fail = (reason: string): TaskResult => ({
      _success: false,
      error: {
        message: `Isolated task process ${reason}`,
        ...(stderrTail.trim() ? { stderr: stderrTail.trim() } : {}),
      },
    });

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      settle(fail(`timed out after ${TASK_PROCESS_TIMEOUT_MS / 1000}s`));
    }, TASK_PROCESS_TIMEOUT_MS);

    const onAbort = () => {
      child.kill("SIGKILL");
      settle(fail("aborted"));
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(
        -STDERR_TAIL_CHARS,
      );
    });

    child.on("error", (error) => {
      settle(fail(`failed to spawn: ${error.message}`));
    });

    child.on("close", (code, signal) => {
      const sentinelIndex = stdout.lastIndexOf(TASK_RESULT_SENTINEL);
      if (sentinelIndex !== -1) {
        const line = stdout
          .slice(sentinelIndex + TASK_RESULT_SENTINEL.length)
          .split("\n", 1)[0];
        try {
          settle(JSON.parse(line) as TaskResult);
          return;
        } catch {
          settle(fail("emitted an unparsable result"));
          return;
        }
      }
      settle(
        fail(
          signal
            ? `was killed by ${signal}`
            : `exited with code ${code} before reporting a result`,
        ),
      );
    });

    child.stdin.end(JSON.stringify(payload));
  });
}
