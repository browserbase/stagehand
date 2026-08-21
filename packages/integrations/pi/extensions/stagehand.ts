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
  releaseBrowserbaseSession,
  stagehandFacadeConfigFromEnv,
} from "@browserbasehq/stagehand-integrations/facade";

type FacadeResources = {
  browser: StagehandBrowser;
  stagehand: Stagehand;
  tools: StagehandFacadeTools;
  releaseSession?: () => Promise<void>;
};

export class StagehandFacadeCleanupError extends Error {
  override readonly name = "StagehandFacadeCleanupError";

  constructor() {
    super("Failed to close the browser session cleanly.");
  }
}

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
  let cleanupPromise: Promise<void> = Promise.resolve();
  const cleanupTargets = new Set<() => Promise<void>>();

  async function facadeTools(): Promise<StagehandFacadeTools> {
    if (resources && !resources.browser.closed) return resources.tools;
    resources = undefined;
    resourcesPromise ??= cleanupPromise.then(retryCleanupTargets).then(async () => {
      const config = stagehandFacadeConfigFromEnv();
      const browser =
        config.browser.type === "browserbase"
          ? await browserbase.launch(config.browser.launchOptions)
          : await localBrowser.launch(config.browser.launchOptions);
      const sessionId = browser.sessionId;
      let releaseSession: (() => Promise<void>) | undefined;
      if (config.browser.type === "browserbase" && sessionId) {
        const { apiKey, baseUrl } = config.browser.launchOptions;
        releaseSession = () => releaseBrowserbaseSession({ apiKey, baseUrl, sessionId });
      }
      try {
        const stagehand = await Stagehand.create({ browser, ...config.stagehand });
        let tools: StagehandFacadeTools;
        tools = new StagehandFacadeTools(stagehand, {
          close: () => closeResources(tools, true),
        });
        return { browser, stagehand, tools, ...(releaseSession ? { releaseSession } : {}) };
      } catch (error) {
        const cleanupErrors: unknown[] = [error];
        let browserCloseFailed = false;
        await browser.close().catch((cleanupError) => {
          browserCloseFailed = true;
          cleanupErrors.push(cleanupError);
        });
        if (browserCloseFailed && releaseSession) {
          await releaseSession().catch((releaseError) => {
            cleanupTargets.add(releaseSession);
            cleanupErrors.push(releaseError);
          });
        }
        if (cleanupErrors.length === 1) throw error;
        throw new AggregateError(
          cleanupErrors,
          "Stagehand initialization failed and browser cleanup also failed.",
          { cause: error },
        );
      }
    });
    try {
      resources = await resourcesPromise;
      return resources.tools;
    } finally {
      resourcesPromise = undefined;
    }
  }

  async function closeResources(
    expected?: StagehandFacadeTools,
    reportErrors = false,
  ): Promise<void> {
    // A shutdown can race a still-pending launch; wait for it so the browser
    // it produces is closed rather than leaked.
    const pending = resourcesPromise;
    const launched = await pending?.catch(() => undefined);
    const current = resources ?? launched;
    if (expected && current?.tools !== expected) return;
    resources = undefined;
    if (!current) {
      if (!reportErrors) {
        await cleanupPromise;
        await retryCleanupTargets().catch(() => undefined);
      }
      return;
    }
    const closeResult = cleanupPromise.then(() => closeResource(current));
    cleanupPromise = closeResult.then(
      () => undefined,
      () => undefined,
    );
    if (!reportErrors) {
      await closeResult.catch(() => undefined);
      await retryCleanupTargets().catch(() => undefined);
      return;
    }
    await closeResult;
  }

  async function closeResource(current: FacadeResources): Promise<void> {
    const cleanupErrors: unknown[] = [];
    let browserCloseFailed = false;
    await current.stagehand.close().catch((error) => cleanupErrors.push(error));
    await current.browser.close().catch((error) => {
      browserCloseFailed = true;
      cleanupErrors.push(error);
    });
    if (browserCloseFailed && current.releaseSession) {
      cleanupTargets.add(current.releaseSession);
    } else if (current.releaseSession) {
      cleanupTargets.delete(current.releaseSession);
    }
    if (cleanupErrors.length === 0) return;
    // Pi surfaces rejected tool executions directly. Keep SDK/CDP details out
    // of the model-visible error, including Error.cause and AggregateError.errors.
    throw new StagehandFacadeCleanupError();
  }

  async function retryCleanupTargets(): Promise<void> {
    for (const releaseSession of cleanupTargets) {
      await releaseSession();
      cleanupTargets.delete(releaseSession);
    }
  }

  pi.on("session_shutdown", () => closeResources());

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
