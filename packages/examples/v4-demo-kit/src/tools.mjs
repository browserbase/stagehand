import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

export const TOOL_DEFINITIONS = [
  {
    name: "run",
    description:
      "Run JavaScript or snapshot actions in one persistent Stagehand browser. JavaScript can use page and context.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", minLength: 1 },
        actions: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              op: { enum: ["click", "hover", "fill", "type", "press", "select"] },
              id: { type: "string" },
              value: { type: "string" },
            },
            required: ["op", "id"],
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "snapshot",
    description: "Read the compact Stagehand page snapshot.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "screenshot",
    description: "Save a screenshot of the active page and return its path.",
    inputSchema: {
      type: "object",
      properties: { fullPage: { type: "boolean" } },
      additionalProperties: false,
    },
  },
];

export function validateToolCall(call) {
  if (!call || typeof call !== "object" || Array.isArray(call)) {
    throw new Error("A tool call must be an object.");
  }
  if (!TOOL_DEFINITIONS.some((tool) => tool.name === call.name)) {
    throw new Error(`Unknown tool: ${String(call.name)}`);
  }
  if (!call.input || typeof call.input !== "object" || Array.isArray(call.input)) {
    throw new Error("Tool input must be an object.");
  }
  if (call.name === "run") {
    const hasCode = Boolean(call.input.code?.trim());
    const hasActions = Array.isArray(call.input.actions) && call.input.actions.length > 0;
    if (hasCode === hasActions) {
      throw new Error("run needs exactly one non-empty code or actions value.");
    }
  }
  return call;
}

export function createDemoTools(session, { artifactDirectory = "artifacts" } = {}) {
  let screenshotNumber = 0;
  let snapshotState;

  return {
    definitions: TOOL_DEFINITIONS,
    async call(rawCall) {
      const call = validateToolCall(rawCall);
      if (call.name === "run") {
        if (call.input.actions) {
          if (!snapshotState) throw new Error("Call snapshot before you use snapshot actions.");
          if ((await session.page.url()) !== snapshotState.url) {
            snapshotState = undefined;
            throw new Error("The page changed after the snapshot. Call snapshot again.");
          }
          const actions = call.input.actions.map((action) => {
            const xpath = snapshotState.xpathById[action.id]?.replace(/\/text\(\)(\[\d+\])?$/u, "");
            if (!xpath) throw new Error(`Snapshot ID ${action.id} is stale or is not actionable.`);
            return { ...action, selector: `xpath=${xpath}` };
          });
          return session.stagehand.experimentalBatch(
            runSnapshotActions,
            { actions },
            { timeout: 60_000 },
          );
        }
        const callback = new AsyncFunction(
          "stagehand",
          "input",
          `"use strict"; const page = stagehand.page; const context = stagehand.context; ${call.input.code}`,
        );
        return session.stagehand.experimentalBatch(callback, {}, { timeout: 60_000 });
      }
      if (call.name === "snapshot") {
        const snapshot = await session.page.snapshot({ includeIframes: true });
        snapshotState = {
          url: await session.page.url(),
          xpathById: { ...snapshot.xpathMap },
        };
        return snapshot.formattedTree;
      }

      const directory = resolve(artifactDirectory);
      await mkdir(directory, { recursive: true });
      screenshotNumber += 1;
      const path = resolve(directory, `stagehand-${screenshotNumber}.png`);
      const bytes = await session.page.screenshot({ fullPage: call.input.fullPage ?? false });
      await writeFile(path, bytes);
      return { path };
    },
  };
}

async function runSnapshotActions(stagehand, input) {
  for (const action of input.actions) {
    const locator = stagehand.page.locator(action.selector);
    if (action.op === "click") await locator.click();
    else if (action.op === "hover") await locator.hover();
    else if (action.op === "fill") await locator.fill(action.value ?? "");
    else if (action.op === "type") await locator.type(action.value ?? "");
    else if (action.op === "press") {
      await locator.click();
      await stagehand.page.keyPress(action.value ?? "Enter");
    } else if (action.op === "select") await locator.selectOption(action.value ?? "");
  }
  return { completed: input.actions.length, url: await stagehand.page.url() };
}
