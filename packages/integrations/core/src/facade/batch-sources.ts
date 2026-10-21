import type { ExperimentalBatchCallback } from "@browserbasehq/stagehand";
import type { RefAction } from "./contract.js";
import { createPlaywrightCompatRuntime, type PlaywrightCompatTelemetry } from "./runtime.js";

/**
 * The JavaScript the facade sends to `experimentalBatch`. The SDK sends a
 * callback's source text, so the exported *_SOURCE / RUN_PRELUDE / RUN_EPILOGUE
 * strings are exactly what reaches the executor and go into the facade bundle
 * unchanged for other hosts.
 */

export type ActionInput = { actions: RefAction[]; xpathById: Record<string, string> };
/** `staleId` is the first action ID that resolved to no XPath; no action ran. */
export type ActionResult =
  | { completed: number; staleId?: never }
  | { staleId: string; completed?: never };
export type ScreenshotArtifact = { path: string; base64: string };
export type RunInput = { hiddenPageIds?: string[]; quietWait?: boolean };
export type RunEnvelope = {
  __stagehandPlaywrightCompat: true;
  value: unknown;
  executionError?: { name: string; message: string; stack?: string };
  telemetry: PlaywrightCompatTelemetry;
  artifacts: ScreenshotArtifact[];
  closeRequested: boolean;
  batchRuntimeMs: number;
};

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

/** Source text of `new AsyncFunction(...params, body)`, fixed by ECMA-262 CreateDynamicFunction. */
const dynamicFunctionHead = (params: string[]) =>
  `async function anonymous(${params.join(",")}\n) {\n`;
const DYNAMIC_FUNCTION_TAIL = "\n}";

/** createPlaywrightCompatRuntime as one self-contained function source. */
export const RUNTIME_SOURCE = createPlaywrightCompatRuntime.toString();

// Snapshot IDs are `<frameOrdinal>-<backendNodeId>` (e.g. "0-7812"). Models
// regularly copy only the backend id; accept that when it is unambiguous.
// Every ID resolves before the first action runs.
const ACTION_RUNNER_BODY = `"use strict";
const resolveSnapshotXPath = (id) => {
  const exact = input.xpathById[id];
  if (exact !== undefined) return exact;
  if (id.includes("-")) return undefined;
  const suffix = "-" + id;
  const matches = Object.keys(input.xpathById).filter((key) => key.endsWith(suffix));
  return matches.length === 1 ? input.xpathById[matches[0]] : undefined;
};
const selectors = [];
for (const action of input.actions) {
  const xpath = resolveSnapshotXPath(action.id)?.replace(/\\/text\\(\\)(\\[\\d+\\])?$/iu, "");
  if (!xpath) return { staleId: action.id };
  selectors.push("xpath=" + xpath);
}
let completed = 0;
for (const [index, action] of input.actions.entries()) {
  const locator = stagehand.page.locator(selectors[index]);
  switch (action.op) {
    case "click": await locator.click(); break;
    case "hover": await locator.hover(); break;
    case "fill": await locator.fill(action.value); break;
    case "type": await locator.type(action.text, action.delay === undefined ? undefined : { delay: action.delay }); break;
    case "press": await locator.click(); await stagehand.page.keyPress(action.key); break;
    case "select": await locator.selectOption(action.values); break;
    default: throw new Error("Unsupported ref action: " + String(action.op));
  }
  completed += 1;
}
return { completed };`;

const RUN_PARAMS = ["batchStagehand", "input"];

const RUN_PRELUDE_BODY = `"use strict";
const __stagehandCompatIdentity = (target) => target;
for (let index = 0; index <= 32; index += 1) {
  globalThis[index === 0 ? "__name" : "__name" + index] = __stagehandCompatIdentity;
}
const createRuntime = ${RUNTIME_SOURCE};
const runtime = await createRuntime(batchStagehand, { hiddenPageIds: input.hiddenPageIds ?? [], quietWait: input.quietWait === true });
const page = runtime.page;
const context = runtime.context;
const browser = runtime.browser;
const console = globalThis.console;
const __stagehandBatchStartedAt = performance.now();
let value;
let executionError;
try {
  value = await (async () => { `;

const RUN_EPILOGUE_BODY = `
  })();
} catch (error) {
  executionError = {
    name: typeof error?.name === "string" ? error.name : "Error",
    message: typeof error?.message === "string" ? error.message : String(error),
    ...(typeof error?.stack === "string" ? { stack: error.stack } : {}),
  };
}
return {
  __stagehandPlaywrightCompat: true,
  value,
  executionError,
  telemetry: runtime.telemetry(),
  artifacts: runtime.artifacts(),
  closeRequested: runtime.closeRequested(),
  batchRuntimeMs: performance.now() - __stagehandBatchStartedAt,
};`;

/** Resolves snapshot IDs against the page's stored XPath map, then runs the actions. */
export const actionRunner = new AsyncFunction(
  "stagehand",
  "input",
  ACTION_RUNNER_BODY,
) as ExperimentalBatchCallback<ActionInput, ActionResult>;

export const ACTION_RUNNER_SOURCE = Function.prototype.toString.call(actionRunner);

/** The source of `runCallback(code)` is `RUN_PRELUDE + code + RUN_EPILOGUE`. */
export const RUN_PRELUDE = dynamicFunctionHead(RUN_PARAMS) + RUN_PRELUDE_BODY;
export const RUN_EPILOGUE = RUN_EPILOGUE_BODY + DYNAMIC_FUNCTION_TAIL;

/**
 * Agent code runs with Playwright-shaped page, context and browser in scope and
 * resolves to a RunEnvelope. The AsyncFunction constructor parses `code` as a
 * whole function body, so it cannot close the wrapper early.
 */
export function runCallback(code: string): ExperimentalBatchCallback<RunInput, RunEnvelope> {
  return new AsyncFunction(
    ...RUN_PARAMS,
    RUN_PRELUDE_BODY + code + RUN_EPILOGUE_BODY,
  ) as ExperimentalBatchCallback<RunInput, RunEnvelope>;
}
