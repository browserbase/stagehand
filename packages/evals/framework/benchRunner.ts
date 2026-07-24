import { EvalsError } from "../errors.js";
import { EvalLogger } from "../logger.js";
import { flattenError } from "./flattenError.js";
import type { EvalInput } from "../types/evals.js";
import type { DiscoveredTask, TaskResult } from "./types.js";
import type { RunEvalsOptions } from "./runner.js";
import { onceAsync, registerActiveRunCleanup } from "./activeRunCleanup.js";
import { getBenchHarness, type BenchHarnessContext } from "./benchHarness.js";
import { buildBenchMatrixRow } from "./benchPlanner.js";
import { DEFAULT_BENCH_HARNESS } from "./benchTypes.js";
import { loadTaskModuleFromPath } from "./taskLoader.js";

function withBenchSessionUrls(
  result: TaskResult,
  ctx: BenchHarnessContext | undefined,
): TaskResult {
  // Every task result funnels through here — flatten Error instances so the
  // failure reason survives JSON serialization into Braintrust rows.
  const flattened =
    result.error === undefined ? result : { ...result, error: flattenError(result.error) };
  if (!ctx) return flattened;

  return {
    ...flattened,
    sessionUrl: result.sessionUrl || ctx.sessionUrl || undefined,
    debugUrl: result.debugUrl || ctx.debugUrl || undefined,
  };
}

export async function executeBenchTask(
  input: EvalInput,
  task: DiscoveredTask,
  options: RunEvalsOptions,
): Promise<TaskResult> {
  const logger = new EvalLogger(Boolean(options.verbose));
  const harnessName = options.harness ?? DEFAULT_BENCH_HARNESS;
  const harness = getBenchHarness(harnessName);
  const row = buildBenchMatrixRow(
    task,
    input.modelName,
    options,
    input.params,
    input.isCUA,
    input.agentMode,
  );
  let cleanup: () => Promise<void> = async () => {};
  let unregisterCleanup: (() => void) | undefined;
  let harnessCtx: BenchHarnessContext | undefined;

  try {
    if (harness.execute) {
      return await harness.execute({
        task,
        input,
        row,
        logger,
        verbose: options.verbose,
        signal: options.signal,
      });
    }

    // Load the task module before starting the harness: init-time meta
    // (e.g. a custom systemPrompt) must reach the Stagehand constructor.
    const taskModule = await loadTaskModuleFromPath(task.filePath, task.name);
    const taskMeta = taskModule.definition?.meta;
    const systemPrompt =
      taskMeta && "systemPrompt" in taskMeta ? taskMeta.systemPrompt : undefined;

    const startedHarness = await harness.start({
      task,
      input,
      row,
      logger,
      verbose: options.verbose,
      systemPrompt,
    });
    cleanup = onceAsync(startedHarness.cleanup);
    unregisterCleanup = registerActiveRunCleanup(cleanup);

    harnessCtx = startedHarness.ctx;
    if (taskModule.definition) {
      const ctx = {
        v3: harnessCtx.v3,
        agent: harnessCtx.agent,
        // v4 rows carry the v4 client/page instead of v3/Playwright ones.
        stagehand: harnessCtx.stagehand,
        page: harnessCtx.page ?? harnessCtx.v4Page,
        logger,
        input,
        modelName: input.modelName,
        debugUrl: harnessCtx.debugUrl,
        sessionUrl: harnessCtx.sessionUrl,
      };
      return withBenchSessionUrls(
        (await taskModule.definition.fn(ctx)) as TaskResult,
        harnessCtx,
      );
    }
    if (taskModule.legacyFn) {
      return withBenchSessionUrls(
        await taskModule.legacyFn({
          v3: harnessCtx.v3,
          logger,
          debugUrl: harnessCtx.debugUrl,
          sessionUrl: harnessCtx.sessionUrl,
          modelName: input.modelName,
          agent: harnessCtx.agent,
          input,
        }),
        harnessCtx,
      );
    }

    throw new EvalsError(`No valid task export found in ${task.filePath}`);
  } catch (error) {
    console.error(`Error in ${input.name}: ${error}`);
    logger.error({
      message: `Error in task ${input.name}`,
      level: 0,
      auxiliary: {
        error: {
          value: error instanceof Error ? error.message : String(error),
          type: "string",
        },
        trace: {
          value: error instanceof Error ? (error.stack ?? "") : "",
          type: "string",
        },
      },
    });
    return withBenchSessionUrls(
      {
        _success: false,
        error: flattenError(error),
        logs: logger.getLogs(),
      },
      harnessCtx,
    );
  } finally {
    await cleanup();
    unregisterCleanup?.();
    logger.clear();
  }
}
