/**
 * pi extension exposing the Stagehand facade tools (run, snapshot,
 * screenshot) as native pi tools.
 *
 * pi has no built-in MCP by design, so this registers the tools directly,
 * importing the contract (descriptions, runtime validators, system prompt)
 * from @browserbasehq/stagehand-integrations/facade rather than restating it.
 */
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  browserbase,
  localBrowser,
  Stagehand,
  type StagehandBrowser,
} from "@browserbasehq/stagehand";
import {
  CodeModeRunInputSchema,
  FACADE_AGENT_INSTRUCTIONS,
  RUN_TOOL_DESCRIPTION,
  SCREENSHOT_TOOL_DESCRIPTION,
  ScreenshotInputSchema,
  SNAPSHOT_TOOL_DESCRIPTION,
  SnapshotInputSchema,
  StagehandFacadeTools,
  stagehandFacadeConfigFromEnv,
} from "@browserbasehq/stagehand-integrations/facade";

type FacadeResources = {
  browser: StagehandBrowser;
  stagehand: Stagehand;
  tools: StagehandFacadeTools;
};

// TypeBox mirrors of the wire schemas (pi validates params with TypeBox; the
// zod validators from the contract re-enforce semantics like code XOR actions
// at execute time). Kept permissive on action items — the contract validator
// is the source of truth.
const runParameters = Type.Object({
  code: Type.Optional(
    Type.String({ description: "JavaScript workflow (Playwright-shaped page API)." }),
  ),
  actions: Type.Optional(
    Type.Array(Type.Record(Type.String(), Type.Unknown()), {
      description:
        'Snapshot actions with the exact fields "op" and "id". Do not use "kind" or "ref".',
    }),
  ),
});

const snapshotParameters = Type.Object({
  includeIframes: Type.Optional(Type.Boolean()),
});

const screenshotParameters = Type.Object({
  fullPage: Type.Optional(Type.Boolean()),
  type: Type.Optional(Type.String({ description: '"png" or "jpeg"' })),
  quality: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
});

export default function stagehandExtension(pi: ExtensionAPI) {
  // Do not start the browser here: extension factories also run in
  // invocations that never start a session (e.g. pi --list-models). The
  // browser launches lazily on first tool call and closes on shutdown.
  let resources: FacadeResources | undefined;
  let resourcesPromise: Promise<FacadeResources> | undefined;

  async function facadeTools(): Promise<StagehandFacadeTools> {
    if (resources && !resources.browser.closed) return resources.tools;
    resources = undefined;
    resourcesPromise ??= (async () => {
      const config = stagehandFacadeConfigFromEnv();
      const browser =
        config.browser.type === "browserbase"
          ? await browserbase.launch(config.browser.launchOptions)
          : await localBrowser.launch(config.browser.launchOptions);
      try {
        const stagehand = await Stagehand.create({ browser, ...config.stagehand });
        return { browser, stagehand, tools: new StagehandFacadeTools(stagehand) };
      } catch (error) {
        await browser.close().catch(() => undefined);
        throw error;
      }
    })();
    try {
      resources = await resourcesPromise;
      return resources.tools;
    } finally {
      resourcesPromise = undefined;
    }
  }

  async function closeResources(): Promise<void> {
    const current = resources;
    resources = undefined;
    if (!current) return;
    await current.stagehand.close().catch(() => undefined);
    await current.browser.close().catch(() => undefined);
  }

  pi.on("session_shutdown", closeResources);

  pi.registerTool({
    name: "run",
    label: "Stagehand run",
    description: RUN_TOOL_DESCRIPTION,
    promptSnippet: "run: execute a JavaScript workflow or snapshot-ID actions in the browser",
    promptGuidelines: [FACADE_AGENT_INSTRUCTIONS],
    parameters: runParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const input = CodeModeRunInputSchema.parse(params);
      const tools = await facadeTools();
      const result =
        input.code !== undefined
          ? await tools.run(input.code)
          : await tools.runActions(input.actions ?? []);
      return {
        content: [{ type: "text", text: JSON.stringify(result) ?? "undefined" }],
        details: result,
      } satisfies AgentToolResult<unknown>;
    },
  });

  pi.registerTool({
    name: "snapshot",
    label: "Stagehand snapshot",
    description: SNAPSHOT_TOOL_DESCRIPTION,
    promptSnippet: "snapshot: inspect the active page and hydrate bracketed element IDs",
    parameters: snapshotParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const input = SnapshotInputSchema.parse(params);
      const tools = await facadeTools();
      const tree = await tools.snapshot(input);
      return {
        content: [{ type: "text", text: tree }],
        details: {},
      } satisfies AgentToolResult<unknown>;
    },
  });

  pi.registerTool({
    name: "screenshot",
    label: "Stagehand screenshot",
    description: SCREENSHOT_TOOL_DESCRIPTION,
    promptSnippet: "screenshot: capture the rendered page as an image",
    parameters: screenshotParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const input = ScreenshotInputSchema.parse(params);
      const tools = await facadeTools();
      const shot = await tools.screenshot(input);
      return {
        content: [{ type: "image", data: shot.data, mimeType: shot.mimeType }],
        details: { mimeType: shot.mimeType },
      } satisfies AgentToolResult<unknown>;
    },
  });
}
