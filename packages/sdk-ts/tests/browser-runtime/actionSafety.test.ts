import { readFile } from "node:fs/promises";
import { trace } from "@opentelemetry/api";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { StagehandLogger } from "../../../extension/logger.js";
import { act } from "../../../extension/services/actService.js";
import { runDecisionsAct } from "../../../extension/services/decisions/act.js";
import { readFacts } from "../../../extension/services/decisions/actionFacts.js";
import { buildPlans } from "../../../extension/services/decisions/actionPlans.js";
import { CdpConnection } from "../../../extension/understudy/cdp.js";
import { browserWebSocketFactory } from "../../../extension/understudy/browserWebSocketTransport.js";
import { executionContexts } from "../../../extension/understudy/executionContextRegistry.js";
import { Page } from "../../../extension/understudy/page.js";
import { runWithProgress } from "../../../extension/understudy/progress.js";
import { launchLocalBrowser } from "../../src/browser/localBrowser.js";
import { resolveBrowserWebSocketUrl } from "../../src/cdpClient.js";

const logger = new StagehandLogger(
  { tracer: trace.getTracer("action-safety") },
  () => {},
  undefined,
  "off",
);
const config = { provider: "typesafe", apiKey: "action-safety-test" } as const;
let chrome: Awaited<ReturnType<typeof launchLocalBrowser>>;
let connection: CdpConnection;
let page: Page | undefined;
let locatorSource: string;

beforeAll(async () => {
  locatorSource = await readFile(
    new URL("../../../extension/dist/content-script.js", import.meta.url),
    "utf8",
  );
  chrome = await launchLocalBrowser({ headless: true }, AbortSignal.timeout(30_000));
  connection = await CdpConnection.connect(
    await resolveBrowserWebSocketUrl(chrome.cdpUrl, { signal: AbortSignal.timeout(5000) }),
    browserWebSocketFactory,
    logger,
  );
}, 35_000);
afterEach(async () => {
  vi.unstubAllGlobals();
  await page?.close();
  page = undefined;
});
afterAll(async () => {
  await connection?.close();
  await chrome?.close();
});

async function open(html: string): Promise<Page> {
  const { targetId } = await connection.send<{ targetId: string }>("Target.createTarget", {
    url: `data:text/html,${encodeURIComponent(html)}`,
  });
  const session = await connection.attachToTarget(targetId);
  executionContexts.attachSession(session);
  await session.send("Runtime.enable");
  page = await Page.create(connection, session, targetId, logger);
  await page.waitForFunction("document.readyState === 'complete'");
  const frameId = page.mainFrameId();
  const { executionContextId } = await session.send<{ executionContextId: number }>(
    "Page.createIsolatedWorld",
    {
      frameId,
      worldName: "action-safety-locators",
    },
  );
  const installed = await session.send<{ exceptionDetails?: unknown }>("Runtime.evaluate", {
    expression: locatorSource,
    contextId: executionContextId,
  });
  expect(installed.exceptionDetails).toBeUndefined();
  executionContexts.registerFallbackWorld(session, frameId, executionContextId);
  return page;
}

function decideAfter(mutate: () => Promise<void>, choice = "action_0") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      await mutate();
      return Response.json({
        model: "jev-1.14.0",
        answers: {
          action: {
            type: "choice",
            choice,
            confidence: 1,
            probabilities: Object.fromEntries(
              Object.keys(body.questions.action.criteria).map((id) => [id, id === choice ? 1 : 0]),
            ),
          },
        },
      });
    }),
  );
}

describe("action safety with real DOM and AX snapshots", () => {
  it.each(["same-XPath replacement", "heading change"])(
    "rejects %s during selection before input",
    async (mutation) => {
      const target = await open(
        "<h1>Invoices</h1><button onclick=\"document.body.dataset.clicked='yes'\">Open</button>",
      );
      const before = await target.captureSnapshot();
      const originalId = Object.entries(before.combinedXpathMap).find(([, path]) =>
        path.endsWith("/button[1]"),
      )![0];
      decideAfter(() =>
        target.evaluate((kind) => {
          if (kind === "heading change")
            document.querySelector("h1")!.textContent = "Delete account";
          else
            document.querySelector("button")!.outerHTML =
              "<button onclick=\"document.body.dataset.clicked='yes'\">Open</button>";
        }, mutation),
      );
      const takeAction = vi.fn();
      const result = await runWithProgress({ name: "action safety", timeout: 5000 }, (progress) =>
        runDecisionsAct(config, {
          page: target,
          logger,
          instruction: "Open the invoice",
          snapshotOptions: {},
          progress,
          takeAction,
        }),
      );
      expect(result).toMatchObject({
        kind: "fallback",
        reason:
          mutation === "heading change"
            ? "action_plan_evidence_changed"
            : "action_plan_target_changed:other_node",
      });
      expect(takeAction).not.toHaveBeenCalled();
      expect(await target.evaluate(() => document.body.dataset.clicked)).toBeUndefined();
      const after = await target.captureSnapshot();
      expect(after.combinedXpathMap[originalId] !== undefined).toBe(mutation === "heading change");
    },
  );

  it("keeps an outside editor out of a locator-scoped plan", async () => {
    const target = await open(
      '<div id="scope"><h1>Message</h1><div contenteditable="true" aria-label="Inside">old text</div></div><div contenteditable="true" aria-label="Outside">secret</div>',
    );
    const snapshot = await target.captureSnapshot({ focusLocator: { selector: "#scope" } });
    const facts = await target.evaluate(readFacts, snapshot.combinedXpathMap);
    const outsideId = Object.keys(facts).find((id) => facts[id]!.name === "Outside")!;
    expect(outsideId).toBeDefined();
    expect(snapshot.combinedTree).not.toContain("Outside");
    const plans = buildPlans(
      {
        formattedTree: snapshot.combinedTree,
        xpathMap: snapshot.combinedXpathMap,
        urlMap: snapshot.combinedUrlMap,
        editableIds: snapshot.combinedEditableIds ?? [],
        facts,
        url: target.url(),
      },
      'Fill Message with "hello"',
    );
    expect(plans.some((plan) => plan.nodeId === outsideId)).toBe(false);
    expect(
      plans.some((plan) => plan.method === "fill" && facts[plan.nodeId]!.name === "Inside"),
    ).toBe(true);
  });

  it("rejects a same-node fallback repurposed while the LLM is running", async () => {
    const target = await open(
      "<button onclick=\"document.body.dataset.clicked='yes'\">Open</button>",
    );
    decideAfter(async () => {}, "none_match");
    const result = await act({
      params: {
        pageId: target.pageId,
        instruction: "Double click Open",
        options: { cache: false, timeout: 5000 },
      },
      page: target,
      logger,
      model: { source: "client" },
      decisions: config,
      clientLLMGenerate: async (params) => {
        const text = params.messages
          .flatMap((message) =>
            Array.isArray(message.content) ? message.content : [message.content],
          )
          .filter((content) => content.type === "text")
          .map((content) => content.text)
          .join("\n");
        const id = text.match(/\[(\d+-\d+)\] button: Open/)![1]!;
        await target.evaluate(() => {
          document.querySelector("button")!.textContent = "Delete";
        });
        return {
          role: "assistant",
          content: { type: "text", text: "action" },
          outputFormat: "json_schema",
          structuredContent: {
            action: { elementId: id, method: "doubleClick", description: "Open", arguments: [] },
            twoStep: false,
          },
        };
      },
    });
    expect(result.data).toMatchObject({ success: false, actions: [] });
    expect(await target.evaluate(() => document.body.dataset.clicked)).toBeUndefined();
  });

  it("rejects a fallback click intercepted by a parent", async () => {
    const target = await open(
      '<div onclick="document.body.dataset.clicked=\'wrong\'"><button style="pointer-events:none">Open</button></div>',
    );
    decideAfter(async () => {}, "none_match");
    const result = await act({
      params: {
        pageId: target.pageId,
        instruction: "Click Open",
        options: { cache: false, timeout: 5000 },
      },
      page: target,
      logger,
      model: { source: "client" },
      decisions: config,
      clientLLMGenerate: async (params) => {
        const text = params.messages
          .flatMap((message) =>
            Array.isArray(message.content) ? message.content : [message.content],
          )
          .filter((content) => content.type === "text")
          .map((content) => content.text)
          .join("\n");
        const id = text.match(/\[(\d+-\d+)\] button: Open/)![1]!;
        return {
          role: "assistant",
          content: { type: "text", text: "action" },
          outputFormat: "json_schema",
          structuredContent: {
            action: { elementId: id, method: "click", description: "Open", arguments: [] },
            twoStep: false,
          },
        };
      },
    });
    expect(result.data).toMatchObject({
      success: false,
      actions: [],
      message: expect.stringContaining("target_covered"),
    });
    expect(await target.evaluate(() => document.body.dataset.clicked)).toBeUndefined();
  });
});
