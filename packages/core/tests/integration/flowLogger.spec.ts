import { expect, test } from "@playwright/test";
import { z } from "zod";
import { InMemoryEventSink } from "../../lib/v3/flowlogger/EventSink.js";
import { FlowEvent } from "../../lib/v3/flowlogger/FlowLogger.js";
import { performUnderstudyMethod } from "../../lib/v3/handlers/handlerUtils/actHandlerUtils.js";
import { V3 } from "../../lib/v3/v3.js";
import {
  createScriptedAisdkTestLlmClient,
  closeV3,
  doneToolResponse,
  findLastEncodedId,
  toolCallResponse,
} from "./testUtils.js";
import { getV3TestConfig } from "./v3.config.js";

function encodeHtml(html: string): string {
  return `data:text/html,${encodeURIComponent(html)}`;
}

function createRecordedFlowLoggerV3(
  overrides: Parameters<typeof getV3TestConfig>[0] = {},
): V3 {
  const v3 = new V3(getV3TestConfig(overrides));
  const sink = new InMemoryEventSink();
  v3.bus.on("*", (event: unknown) => {
    if (event instanceof FlowEvent) {
      void sink.emit(event);
    }
  });
  v3.eventStore.query = (query) =>
    sink.query({ ...query, sessionId: v3.eventStore.sessionId });
  return v3;
}

async function listRecordedFlowEvents(v3: V3): Promise<FlowEvent[]> {
  return v3.eventStore.query({});
}

async function captureFlowEventBaseline(v3: V3): Promise<Set<string>> {
  const events = await listRecordedFlowEvents(v3);
  return new Set(events.map((event) => event.eventId));
}

async function listRecordedFlowEventsSince(
  v3: V3,
  baseline: Set<string>,
): Promise<FlowEvent[]> {
  const events = await listRecordedFlowEvents(v3);
  return events.filter((event) => !baseline.has(event.eventId));
}

function eventsOfType(events: FlowEvent[], eventType: string): FlowEvent[] {
  return events.filter((event) => event.eventType === eventType);
}

function requireSingleEvent(events: FlowEvent[], eventType: string): FlowEvent {
  const matches = eventsOfType(events, eventType);
  expect(matches, `expected a single ${eventType}`).toHaveLength(1);
  return matches[0];
}

function expectRootEvent(event: FlowEvent): void {
  expect(event.eventParentIds).toEqual([]);
}

function expectDirectParent(child: FlowEvent, parent: FlowEvent): void {
  expect(child.eventParentIds).toEqual([
    ...parent.eventParentIds,
    parent.eventId,
  ]);
}

function assertAllParentIdsResolve(events: FlowEvent[]): void {
  const eventIds = new Set(events.map((event) => event.eventId));

  for (const event of events) {
    for (const parentId of event.eventParentIds) {
      expect(
        eventIds.has(parentId),
        `${event.eventType} references missing parent ${parentId}`,
      ).toBe(true);
    }
  }
}

function assertSessionIds(events: FlowEvent[], sessionId: string): void {
  for (const event of events) {
    expect(event.sessionId).toBe(sessionId);
  }
}

function directChildrenOfType(
  events: FlowEvent[],
  parent: FlowEvent,
  eventType: string,
): FlowEvent[] {
  const expectedParentIds = [...parent.eventParentIds, parent.eventId];
  return events.filter(
    (event) =>
      event.eventType === eventType &&
      JSON.stringify(event.eventParentIds) ===
        JSON.stringify(expectedParentIds),
  );
}

function assertCompletedEnvelope(
  events: FlowEvent[],
  eventType: string,
  completedEventType = `${eventType.replace(/Event$/, "")}CompletedEvent`,
): FlowEvent {
  const root = requireSingleEvent(events, eventType);
  const completed = requireSingleEvent(events, completedEventType);
  expectDirectParent(completed, root);
  return root;
}

function assertNoFloatingLlmEvents(events: FlowEvent[]): void {
  const llmEvents = events.filter(
    (event) =>
      event.eventType === "LlmRequestEvent" ||
      event.eventType === "LlmResponseEvent",
  );
  const byId = new Map(events.map((event) => [event.eventId, event]));

  expect(llmEvents.length).toBeGreaterThan(0);

  for (const event of llmEvents) {
    expect(
      event.eventParentIds.length,
      `${event.eventType} is floating`,
    ).toBeGreaterThan(0);
    const lastParentId = event.eventParentIds.at(-1);
    const lastParent = lastParentId ? byId.get(lastParentId) : undefined;
    expect(
      lastParent,
      `${event.eventType} has no resolved parent`,
    ).toBeDefined();
    expect(lastParent?.eventType.startsWith("Llm")).toBe(false);
  }
}

function assertNoFloatingCdpEvents(events: FlowEvent[]): void {
  const cdpEvents = events.filter((event) => event.eventType.startsWith("Cdp"));
  const byId = new Map(events.map((event) => [event.eventId, event]));

  expect(cdpEvents.length).toBeGreaterThan(0);

  for (const event of cdpEvents) {
    expect(
      event.eventParentIds.length,
      `${event.eventType} is floating`,
    ).toBeGreaterThan(0);
    const lastParentId = event.eventParentIds.at(-1);
    const lastParent = lastParentId ? byId.get(lastParentId) : undefined;
    expect(
      lastParent,
      `${event.eventType} has no resolved parent`,
    ).toBeDefined();

    if (event.eventType === "CdpCallEvent") {
      expect(lastParent?.eventType.startsWith("Cdp")).toBe(false);
    } else {
      expect(lastParent?.eventType).toBe("CdpCallEvent");
    }
  }
}

function assertDirectRootCdpEvents(
  events: FlowEvent[],
  sessionId: string,
): void {
  const call = requireSingleEvent(events, "CdpCallEvent");
  const responseTypes = ["CdpResponseEvent", "CdpResponseErrorEvent"];
  const response = events.find((event) =>
    responseTypes.includes(event.eventType),
  );

  expect(response, "expected a direct CDP response event").toBeDefined();
  assertSessionIds(events, sessionId);
  expectRootEvent(call);
  expect(response?.eventParentIds).toEqual([call.eventId]);
}

function sortCountRecord(
  input: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(input).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function assertNonCdpEventCounts(
  events: FlowEvent[],
  expected: Record<string, number>,
): void {
  const actual = events.reduce<Record<string, number>>((counts, event) => {
    if (event.eventType.startsWith("Cdp")) {
      return counts;
    }

    counts[event.eventType] = (counts[event.eventType] ?? 0) + 1;
    return counts;
  }, {});

  expect(sortCountRecord(actual)).toEqual(sortCountRecord(expected));
}

test.describe("flow logger integration", () => {
  test.describe.configure({ mode: "serial" });

  test("act emits a rooted tree with nested understudy, llm, and cdp events", async () => {
    const buttonText = "Flow Logger Act Button";
    const llmClient = createScriptedAisdkTestLlmClient({
      jsonResponses: {
        act: (options) => ({
          elementId: findLastEncodedId(options),
          description: `click ${buttonText}`,
          method: "click",
          arguments: [],
          twoStep: false,
        }),
      },
    });

    const v3 = createRecordedFlowLoggerV3({
      llmClient,
    });

    await v3.init();

    try {
      const page = v3.context.pages()[0];
      await page.goto(
        encodeHtml(`
          <!doctype html>
          <html>
            <body>
              <button
                id="act-target"
                onclick="document.body.dataset.clicked='true'"
              >
                ${buttonText}
              </button>
            </body>
          </html>
        `),
      );

      const baseline = await captureFlowEventBaseline(v3);
      const result = await v3.act(`Click the ${buttonText}`);
      const events = await listRecordedFlowEventsSince(v3, baseline);

      expect(result.success).toBe(true);
      expect(
        await page.evaluate(() => document.body.dataset.clicked ?? ""),
      ).toBe("true");
      const root = requireSingleEvent(events, "StagehandActEvent");
      const completed = requireSingleEvent(
        events,
        "StagehandActCompletedEvent",
      );
      const llmRequest = requireSingleEvent(events, "LlmRequestEvent");
      const llmResponse = requireSingleEvent(events, "LlmResponseEvent");
      const understudy = requireSingleEvent(events, "UnderstudyClickEvent");
      const understudyCompleted = requireSingleEvent(
        events,
        "UnderstudyClickCompletedEvent",
      );

      assertAllParentIdsResolve(events);
      assertNonCdpEventCounts(events, {
        LlmRequestEvent: 1,
        LlmResponseEvent: 1,
        StagehandActCompletedEvent: 1,
        StagehandActEvent: 1,
        UnderstudyClickCompletedEvent: 1,
        UnderstudyClickEvent: 1,
      });
      assertSessionIds(events, v3.flowLoggerContext.sessionId);
      expectRootEvent(root);
      expectDirectParent(completed, root);
      expect(llmRequest.eventParentIds).toEqual([root.eventId]);
      expect(llmResponse.eventParentIds).toEqual([root.eventId]);
      expect(understudy.eventParentIds).toEqual([root.eventId]);
      expectDirectParent(understudyCompleted, understudy);
      assertNoFloatingLlmEvents(events);
      assertNoFloatingCdpEvents(events);
    } finally {
      await closeV3(v3);
    }
  });

  test("observe and extract emit rooted trees with complete nested llm and cdp events", async () => {
    const observeText = "Flow Logger Observe Button";
    const extractTitle = "Flow Logger Extract Title";
    const llmClient = createScriptedAisdkTestLlmClient({
      jsonResponses: {
        Observation: (options) => ({
          elements: [
            {
              elementId: findLastEncodedId(options),
              description: observeText,
              method: "click",
              arguments: [],
            },
          ],
        }),
        Extraction: {
          title: extractTitle,
        },
        Metadata: {
          completed: true,
          progress: "done",
        },
      },
    });

    const v3 = createRecordedFlowLoggerV3({
      llmClient,
    });

    await v3.init();

    try {
      const page = v3.context.pages()[0];
      await page.goto(
        encodeHtml(`
          <!doctype html>
          <html>
            <body>
              <button id="observe-target">${observeText}</button>
              <h1>${extractTitle}</h1>
            </body>
          </html>
        `),
      );

      const observeBaseline = await captureFlowEventBaseline(v3);
      const observeResult = await v3.observe(`Find the ${observeText}`);

      expect(observeResult).toHaveLength(1);
      expect(observeResult[0].method).toBe("click");

      const observeEvents = await listRecordedFlowEventsSince(
        v3,
        observeBaseline,
      );
      const observeRoot = requireSingleEvent(
        observeEvents,
        "StagehandObserveEvent",
      );
      const observeCompleted = requireSingleEvent(
        observeEvents,
        "StagehandObserveCompletedEvent",
      );
      const observeLlmRequests = eventsOfType(observeEvents, "LlmRequestEvent");
      const observeLlmResponses = eventsOfType(
        observeEvents,
        "LlmResponseEvent",
      );

      assertAllParentIdsResolve(observeEvents);
      assertNonCdpEventCounts(observeEvents, {
        LlmRequestEvent: 1,
        LlmResponseEvent: 1,
        StagehandObserveCompletedEvent: 1,
        StagehandObserveEvent: 1,
      });
      assertSessionIds(observeEvents, v3.flowLoggerContext.sessionId);
      expectRootEvent(observeRoot);
      expectDirectParent(observeCompleted, observeRoot);
      expect(observeLlmRequests).toHaveLength(1);
      expect(observeLlmResponses).toHaveLength(1);
      expect(observeLlmRequests[0].eventParentIds).toEqual([
        observeRoot.eventId,
      ]);
      expect(observeLlmResponses[0].eventParentIds).toEqual([
        observeRoot.eventId,
      ]);
      assertNoFloatingLlmEvents(observeEvents);
      assertNoFloatingCdpEvents(observeEvents);

      const extractBaseline = await captureFlowEventBaseline(v3);
      const extractResult = await v3.extract(
        "Extract the title",
        z.object({ title: z.string() }),
      );

      expect(extractResult).toEqual({ title: extractTitle });

      const extractEvents = await listRecordedFlowEventsSince(
        v3,
        extractBaseline,
      );
      const extractRoot = requireSingleEvent(
        extractEvents,
        "StagehandExtractEvent",
      );
      const extractCompleted = requireSingleEvent(
        extractEvents,
        "StagehandExtractCompletedEvent",
      );
      const extractLlmRequests = eventsOfType(extractEvents, "LlmRequestEvent");
      const extractLlmResponses = eventsOfType(
        extractEvents,
        "LlmResponseEvent",
      );

      assertAllParentIdsResolve(extractEvents);
      assertNonCdpEventCounts(extractEvents, {
        LlmRequestEvent: 2,
        LlmResponseEvent: 2,
        StagehandExtractCompletedEvent: 1,
        StagehandExtractEvent: 1,
      });
      assertSessionIds(extractEvents, v3.flowLoggerContext.sessionId);
      expectRootEvent(extractRoot);
      expectDirectParent(extractCompleted, extractRoot);
      expect(extractLlmRequests).toHaveLength(2);
      expect(extractLlmResponses).toHaveLength(2);

      for (const event of [...extractLlmRequests, ...extractLlmResponses]) {
        expect(event.eventParentIds).toEqual([extractRoot.eventId]);
      }

      assertNoFloatingLlmEvents(extractEvents);
      assertNoFloatingCdpEvents(extractEvents);
    } finally {
      await closeV3(v3);
    }
  });

  test("agent.execute -> act carries the full agent -> stagehand -> understudy -> cdp + llm hierarchy", async () => {
    const buttonText = "Agent Act Button";
    const llmClient = createScriptedAisdkTestLlmClient({
      jsonResponses: {
        act: (options) => ({
          elementId: findLastEncodedId(options),
          description: `click ${buttonText}`,
          method: "click",
          arguments: [],
          twoStep: false,
        }),
      },
      generateResponses: [
        toolCallResponse("act", { action: `click the ${buttonText}` }, "act-1"),
        doneToolResponse("finished", true, "done-1"),
      ],
    });

    const v3 = createRecordedFlowLoggerV3({
      experimental: true,
      llmClient,
    });

    await v3.init();

    try {
      const page = v3.context.pages()[0];
      await page.goto(
        encodeHtml(`
          <!doctype html>
          <html>
            <body>
              <button
                id="agent-act-target"
                onclick="document.body.dataset.agentAct='true'"
              >
                ${buttonText}
              </button>
            </body>
          </html>
        `),
      );

      const baseline = await captureFlowEventBaseline(v3);
      const result = await v3.agent().execute({
        instruction: `Click the ${buttonText} and finish.`,
        maxSteps: 2,
      });
      const events = await listRecordedFlowEventsSince(v3, baseline);

      expect(result.success).toBe(true);
      expect(
        await page.evaluate(() => document.body.dataset.agentAct ?? ""),
      ).toBe("true");
      const agentRoot = assertCompletedEnvelope(events, "AgentExecuteEvent");
      const actRoot = requireSingleEvent(events, "StagehandActEvent");
      const actCompleted = requireSingleEvent(
        events,
        "StagehandActCompletedEvent",
      );
      const understudy = requireSingleEvent(events, "UnderstudyClickEvent");
      const understudyCompleted = requireSingleEvent(
        events,
        "UnderstudyClickCompletedEvent",
      );

      assertAllParentIdsResolve(events);
      assertNonCdpEventCounts(events, {
        AgentExecuteCompletedEvent: 1,
        AgentExecuteEvent: 1,
        LlmRequestEvent: 3,
        LlmResponseEvent: 3,
        StagehandActCompletedEvent: 1,
        StagehandActEvent: 1,
        UnderstudyClickCompletedEvent: 1,
        UnderstudyClickEvent: 1,
      });
      assertSessionIds(events, v3.flowLoggerContext.sessionId);
      expectRootEvent(agentRoot);
      expect(actRoot.eventParentIds).toEqual([agentRoot.eventId]);
      expectDirectParent(actCompleted, actRoot);
      expectDirectParent(understudy, actRoot);
      expectDirectParent(understudyCompleted, understudy);
      expect(
        directChildrenOfType(events, agentRoot, "LlmRequestEvent"),
      ).toHaveLength(2);
      expect(
        directChildrenOfType(events, agentRoot, "LlmResponseEvent"),
      ).toHaveLength(2);
      expect(
        directChildrenOfType(events, actRoot, "LlmRequestEvent"),
      ).toHaveLength(1);
      expect(
        directChildrenOfType(events, actRoot, "LlmResponseEvent"),
      ).toHaveLength(1);
      assertNoFloatingLlmEvents(events);
      assertNoFloatingCdpEvents(events);
    } finally {
      await closeV3(v3);
    }
  });

  test("agent.execute -> fillForm carries the observe -> act -> understudy hierarchy with no missing layers", async () => {
    const llmClient = createScriptedAisdkTestLlmClient({
      jsonResponses: {
        Observation: (options) => ({
          elements: [
            {
              elementId: findLastEncodedId(options),
              description: "name input",
              method: "fill",
              arguments: ["hello"],
            },
          ],
        }),
      },
      generateResponses: [
        toolCallResponse(
          "fillForm",
          {
            fields: [
              {
                action: "type hello into the name field",
                value: "hello",
              },
            ],
          },
          "fillform-1",
        ),
        doneToolResponse("finished", true, "done-1"),
      ],
    });

    const v3 = createRecordedFlowLoggerV3({
      experimental: true,
      llmClient,
    });

    await v3.init();

    try {
      const page = v3.context.pages()[0];
      await page.goto(
        encodeHtml(`
          <!doctype html>
          <html>
            <body>
              <input id="name" />
            </body>
          </html>
        `),
      );

      const baseline = await captureFlowEventBaseline(v3);
      const result = await v3.agent().execute({
        instruction: "Fill the form and finish.",
        maxSteps: 2,
      });
      const events = await listRecordedFlowEventsSince(v3, baseline);

      expect(result.success).toBe(true);
      expect(await page.locator("#name").inputValue()).toBe("hello");

      const agentRoot = assertCompletedEnvelope(events, "AgentExecuteEvent");
      const observeRoot = requireSingleEvent(events, "StagehandObserveEvent");
      const observeCompleted = requireSingleEvent(
        events,
        "StagehandObserveCompletedEvent",
      );
      const actRoot = requireSingleEvent(events, "StagehandActEvent");
      const actCompleted = requireSingleEvent(
        events,
        "StagehandActCompletedEvent",
      );
      const understudyFill = requireSingleEvent(events, "UnderstudyFillEvent");
      const understudyFillCompleted = requireSingleEvent(
        events,
        "UnderstudyFillCompletedEvent",
      );

      assertAllParentIdsResolve(events);
      assertNonCdpEventCounts(events, {
        AgentExecuteCompletedEvent: 1,
        AgentExecuteEvent: 1,
        LlmRequestEvent: 3,
        LlmResponseEvent: 3,
        StagehandActCompletedEvent: 1,
        StagehandActEvent: 1,
        StagehandObserveCompletedEvent: 1,
        StagehandObserveEvent: 1,
        UnderstudyFillCompletedEvent: 1,
        UnderstudyFillEvent: 1,
      });
      assertSessionIds(events, v3.flowLoggerContext.sessionId);
      expectRootEvent(agentRoot);
      expect(observeRoot.eventParentIds).toEqual([agentRoot.eventId]);
      expectDirectParent(observeCompleted, observeRoot);
      expect(actRoot.eventParentIds).toEqual([agentRoot.eventId]);
      expectDirectParent(actCompleted, actRoot);
      expectDirectParent(understudyFill, actRoot);
      expectDirectParent(understudyFillCompleted, understudyFill);
      expect(
        directChildrenOfType(events, observeRoot, "LlmRequestEvent"),
      ).toHaveLength(1);
      expect(
        directChildrenOfType(events, observeRoot, "LlmResponseEvent"),
      ).toHaveLength(1);
      expect(
        directChildrenOfType(events, agentRoot, "LlmRequestEvent"),
      ).toHaveLength(2);
      expect(
        directChildrenOfType(events, agentRoot, "LlmResponseEvent"),
      ).toHaveLength(2);
      expect(
        directChildrenOfType(events, actRoot, "LlmRequestEvent"),
      ).toHaveLength(0);
      expect(
        directChildrenOfType(events, actRoot, "LlmResponseEvent"),
      ).toHaveLength(0);
      assertNoFloatingLlmEvents(events);
      assertNoFloatingCdpEvents(events);
    } finally {
      await closeV3(v3);
    }
  });

  test("agent.execute -> extract carries the full agent -> extract -> cdp + llm hierarchy", async () => {
    const extractTitle = "Agent Extract Title";
    const llmClient = createScriptedAisdkTestLlmClient({
      jsonResponses: {
        Extraction: {
          title: extractTitle,
        },
        Metadata: {
          completed: true,
          progress: "done",
        },
      },
      generateResponses: [
        toolCallResponse(
          "extract",
          {
            instruction: "extract the title",
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
              },
            },
          },
          "extract-1",
        ),
        doneToolResponse("finished", true, "done-1"),
      ],
    });

    const v3 = createRecordedFlowLoggerV3({
      experimental: true,
      llmClient,
    });

    await v3.init();

    try {
      const page = v3.context.pages()[0];
      await page.goto(
        encodeHtml(`
          <!doctype html>
          <html>
            <body>
              <h1>${extractTitle}</h1>
            </body>
          </html>
        `),
      );

      const baseline = await captureFlowEventBaseline(v3);
      const result = await v3.agent().execute({
        instruction: "Extract the title and finish.",
        maxSteps: 2,
      });

      expect(result.success).toBe(true);

      const events = await listRecordedFlowEventsSince(v3, baseline);
      const agentRoot = assertCompletedEnvelope(events, "AgentExecuteEvent");
      const extractRoot = requireSingleEvent(events, "StagehandExtractEvent");
      const extractCompleted = requireSingleEvent(
        events,
        "StagehandExtractCompletedEvent",
      );

      assertAllParentIdsResolve(events);
      assertNonCdpEventCounts(events, {
        AgentExecuteCompletedEvent: 1,
        AgentExecuteEvent: 1,
        LlmRequestEvent: 4,
        LlmResponseEvent: 4,
        StagehandExtractCompletedEvent: 1,
        StagehandExtractEvent: 1,
      });
      assertSessionIds(events, v3.flowLoggerContext.sessionId);
      expectRootEvent(agentRoot);
      expect(extractRoot.eventParentIds).toEqual([agentRoot.eventId]);
      expectDirectParent(extractCompleted, extractRoot);
      expect(
        directChildrenOfType(events, agentRoot, "LlmRequestEvent"),
      ).toHaveLength(2);
      expect(
        directChildrenOfType(events, agentRoot, "LlmResponseEvent"),
      ).toHaveLength(2);
      expect(
        directChildrenOfType(events, extractRoot, "LlmRequestEvent"),
      ).toHaveLength(2);
      expect(
        directChildrenOfType(events, extractRoot, "LlmResponseEvent"),
      ).toHaveLength(2);
      assertNoFloatingLlmEvents(events);
      assertNoFloatingCdpEvents(events);
    } finally {
      await closeV3(v3);
    }
  });

  test("agent.execute nests page events under the agent root and direct page calls root themselves", async () => {
    const agentPageUrl = encodeHtml(`
      <!doctype html>
      <html>
        <body>
          <h1>Agent Flow Logger Page</h1>
        </body>
      </html>
    `);
    const agentLlmClient = createScriptedAisdkTestLlmClient({
      generateResponses: [
        toolCallResponse("goto", { url: agentPageUrl }, "goto-1"),
        toolCallResponse("screenshot", {}, "screenshot-1"),
        doneToolResponse("finished", true, "done-1"),
      ],
    });

    const agentV3 = createRecordedFlowLoggerV3({
      experimental: true,
      llmClient: agentLlmClient,
    });

    await agentV3.init();

    try {
      const baseline = await captureFlowEventBaseline(agentV3);
      const result = await agentV3.agent().execute({
        instruction: "Go to the test page, take a screenshot, and finish.",
        maxSteps: 3,
      });

      expect(result.success).toBe(true);
      expect(result.completed).toBe(true);

      const events = await listRecordedFlowEventsSince(agentV3, baseline);
      const root = assertCompletedEnvelope(events, "AgentExecuteEvent");
      const pageGoto = requireSingleEvent(events, "PageGotoEvent");
      const pageGotoCompleted = requireSingleEvent(
        events,
        "PageGotoCompletedEvent",
      );
      const pageScreenshot = requireSingleEvent(events, "PageScreenshotEvent");
      const pageScreenshotCompleted = requireSingleEvent(
        events,
        "PageScreenshotCompletedEvent",
      );
      const llmRequests = eventsOfType(events, "LlmRequestEvent");
      const llmResponses = eventsOfType(events, "LlmResponseEvent");

      assertAllParentIdsResolve(events);
      assertNonCdpEventCounts(events, {
        AgentExecuteCompletedEvent: 1,
        AgentExecuteEvent: 1,
        LlmRequestEvent: 3,
        LlmResponseEvent: 3,
        PageGotoCompletedEvent: 1,
        PageGotoEvent: 1,
        PageScreenshotCompletedEvent: 1,
        PageScreenshotEvent: 1,
      });
      assertSessionIds(events, agentV3.flowLoggerContext.sessionId);
      expectRootEvent(root);
      expect(pageGoto.eventParentIds).toEqual([root.eventId]);
      expectDirectParent(pageGotoCompleted, pageGoto);
      expect(pageScreenshot.eventParentIds).toEqual([root.eventId]);
      expectDirectParent(pageScreenshotCompleted, pageScreenshot);
      expect(llmRequests).toHaveLength(3);
      expect(llmResponses).toHaveLength(3);

      for (const event of [...llmRequests, ...llmResponses]) {
        expect(event.eventParentIds).toEqual([root.eventId]);
      }

      assertNoFloatingLlmEvents(events);
      assertNoFloatingCdpEvents(events);
    } finally {
      await closeV3(agentV3);
    }

    const directV3 = createRecordedFlowLoggerV3();
    await directV3.init();

    try {
      const page = directV3.context.pages()[0];
      const baseline = await captureFlowEventBaseline(directV3);

      await page.goto(agentPageUrl);
      await page.screenshot({ fullPage: false });

      const events = await listRecordedFlowEventsSince(directV3, baseline);
      const pageGoto = requireSingleEvent(events, "PageGotoEvent");
      const pageGotoCompleted = requireSingleEvent(
        events,
        "PageGotoCompletedEvent",
      );
      const pageScreenshot = requireSingleEvent(events, "PageScreenshotEvent");
      const pageScreenshotCompleted = requireSingleEvent(
        events,
        "PageScreenshotCompletedEvent",
      );

      assertAllParentIdsResolve(events);
      assertNonCdpEventCounts(events, {
        PageGotoCompletedEvent: 1,
        PageGotoEvent: 1,
        PageScreenshotCompletedEvent: 1,
        PageScreenshotEvent: 1,
      });
      assertSessionIds(events, directV3.flowLoggerContext.sessionId);
      expectRootEvent(pageGoto);
      expectDirectParent(pageGotoCompleted, pageGoto);
      expectRootEvent(pageScreenshot);
      expectDirectParent(pageScreenshotCompleted, pageScreenshot);
      expect(eventsOfType(events, "LlmRequestEvent")).toHaveLength(0);
      expect(eventsOfType(events, "LlmResponseEvent")).toHaveLength(0);
      assertNoFloatingCdpEvents(events);
    } finally {
      await closeV3(directV3);
    }
  });

  test("direct page methods, direct understudy calls, and direct sendCDP all attach complete event trees to the session", async () => {
    const v3 = createRecordedFlowLoggerV3();
    await v3.init();

    try {
      const page = v3.context.pages()[0];
      await page.goto(
        encodeHtml(`
          <!doctype html>
          <html>
            <body>
              <button
                id="direct-click"
                onclick="document.body.dataset.directClick='true'"
              >
                Direct Click
              </button>
              <div id="ready">ready</div>
            </body>
          </html>
        `),
      );

      let baseline = await captureFlowEventBaseline(v3);
      await page.evaluate(() => document.getElementById("ready")?.textContent);
      let events = await listRecordedFlowEventsSince(v3, baseline);
      let root = assertCompletedEnvelope(events, "PageEvaluateEvent");
      assertAllParentIdsResolve(events);
      assertNonCdpEventCounts(events, {
        PageEvaluateCompletedEvent: 1,
        PageEvaluateEvent: 1,
      });
      assertSessionIds(events, v3.flowLoggerContext.sessionId);
      expectRootEvent(root);
      expect(eventsOfType(events, "LlmRequestEvent")).toHaveLength(0);
      expect(eventsOfType(events, "LlmResponseEvent")).toHaveLength(0);
      assertNoFloatingCdpEvents(events);

      baseline = await captureFlowEventBaseline(v3);
      await page.snapshot();
      events = await listRecordedFlowEventsSince(v3, baseline);
      root = assertCompletedEnvelope(events, "PageSnapshotEvent");
      assertAllParentIdsResolve(events);
      assertNonCdpEventCounts(events, {
        PageSnapshotCompletedEvent: 1,
        PageSnapshotEvent: 1,
      });
      assertSessionIds(events, v3.flowLoggerContext.sessionId);
      expectRootEvent(root);
      expect(eventsOfType(events, "LlmRequestEvent")).toHaveLength(0);
      expect(eventsOfType(events, "LlmResponseEvent")).toHaveLength(0);
      assertNoFloatingCdpEvents(events);

      baseline = await captureFlowEventBaseline(v3);
      await performUnderstudyMethod(
        page,
        page.mainFrame(),
        "click",
        "/html/body/button",
        [],
        30_000,
      );
      events = await listRecordedFlowEventsSince(v3, baseline);
      root = assertCompletedEnvelope(events, "UnderstudyClickEvent");
      assertAllParentIdsResolve(events);
      assertNonCdpEventCounts(events, {
        UnderstudyClickCompletedEvent: 1,
        UnderstudyClickEvent: 1,
      });
      assertSessionIds(events, v3.flowLoggerContext.sessionId);
      expectRootEvent(root);
      expect(eventsOfType(events, "LlmRequestEvent")).toHaveLength(0);
      expect(eventsOfType(events, "LlmResponseEvent")).toHaveLength(0);
      assertNoFloatingCdpEvents(events);
      expect(
        await page.evaluate(() => document.body.dataset.directClick ?? ""),
      ).toBe("true");

      baseline = await captureFlowEventBaseline(v3);
      const cdpResult = await page.sendCDP<{
        result?: { value?: number };
      }>("Runtime.evaluate", {
        expression: "2 + 2",
        returnByValue: true,
      });
      events = await listRecordedFlowEventsSince(v3, baseline);
      expect(cdpResult.result?.value).toBe(4);
      expect(eventsOfType(events, "LlmRequestEvent")).toHaveLength(0);
      expect(eventsOfType(events, "LlmResponseEvent")).toHaveLength(0);
      assertAllParentIdsResolve(events);
      assertDirectRootCdpEvents(events, v3.flowLoggerContext.sessionId);
    } finally {
      await closeV3(v3);
    }
  });
});
