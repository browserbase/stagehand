/**
 * Child-process entrypoint for isolated bench task execution (--isolate).
 *
 * Reads a JSON payload from stdin ({ input, task, options }), runs the task
 * through the normal executeBenchTask path, and emits the TaskResult as a
 * single sentinel-framed line on stdout. Everything else the task prints
 * (SDK notifications, console noise) passes through untouched — the parent
 * only trusts the sentinel line.
 *
 * A hard crash here (OOM, unhandled rejection, hung SDK) kills only this
 * process; the parent synthesizes a failed TaskResult from the exit.
 */
import { executeBenchTask } from "./benchRunner.js";
import { hasBraintrustApiKey, loadBraintrust } from "./braintrust.js";
import type { IsolatedTaskPayload } from "./benchTaskIsolation.js";
import { TASK_RESULT_SENTINEL } from "./benchTaskIsolation.js";
import type { RunEvalsOptions } from "./runner.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const payload = JSON.parse(await readStdin()) as IsolatedTaskPayload;

// The serializable option subset is all executeBenchTask reads; the
// coordination-only fields (tasks/registry/signal/onProgress) never cross
// the process boundary.
const run = () =>
  executeBenchTask(
    payload.input,
    payload.task,
    payload.options as RunEvalsOptions,
  );

// Re-enter the parent row's Braintrust trace so spans created in this
// process (verifier.verify etc.) attach to it; wrap execution in an
// `isolated:` span so the process boundary is visible in the trace.
// Best-effort: tracing must never change execution behavior.
let result;
if (payload.braintrustParent && hasBraintrustApiKey()) {
  const bt = await loadBraintrust();
  // No Eval() context exists in this process - log in explicitly, then
  // attach directly to the exported parent span (the documented
  // distributed-tracing pattern). Nested tracedSpan calls inside
  // executeBenchTask chain off this span via the current-span context.
  await bt.login({});
  result = await bt.traced(() => run(), {
    name: `isolated:${payload.task.name}`,
    parent: payload.braintrustParent,
  });
  await bt.flush();
} else {
  result = await run();
}

// Error instances JSON-serialize to {} — flatten them at the boundary so
// task results that still carry raw errors stay diagnosable in the parent
// (the same masking class the task-level flattenError work addressed).
const replacer = (_key: string, value: unknown): unknown =>
  value instanceof Error
    ? { message: value.message, ...(value.stack ? { stack: value.stack } : {}) }
    : value;

process.stdout.write(
  `\n${TASK_RESULT_SENTINEL}${JSON.stringify(result, replacer)}\n`,
);
process.exit(0);
