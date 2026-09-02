import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PageCDPEvent, Stagehand, WebMCPTool } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

const WEBMCP_IFRAME_URL = "https://browserbase.github.io/stagehand-eval-sites/sites/webmcp-iframe/";
const FRAME_READY_MARKER = "stagehand-webmcp-frame-ready";
const IFRAME_TOOL_NAME = "set_test_panel";
const IFRAME_TOOL_INPUT = {
  title: "Stagehand OOPIF test",
  message: "Invoked from the WebMCP iframe integration test.",
  tone: "success",
};

describe("WebMCP iframe support", () => {
  let stagehand: Stagehand;

  beforeAll(async () => {
    stagehand = await createStagehand();
  });

  afterAll(async () => {
    await closeStagehand(stagehand);
  });

  it("discovers and invokes tools in a cross-origin OOPIF", async () => {
    const page = await firstPage(stagehand);
    const frameEvents: PageCDPEvent[] = [];
    const subscription = await page.on("console", (event) => {
      if (consoleArgument(event, 0) === FRAME_READY_MARKER) frameEvents.push(event);
    });

    try {
      await page.addInitScript((marker) => {
        // eslint-disable-next-line no-console -- the event proves which CDP session owns this frame
        console.log(marker, window === window.top ? "main" : "child", location.href);
      }, FRAME_READY_MARKER);
      await page.goto(WEBMCP_IFRAME_URL, { waitUntil: "load" });

      await expect
        .poll(() => readyFrameTargets(frameEvents), {
          timeout: 10_000,
          interval: 50,
        })
        .toMatchObject({
          main: expect.objectContaining({ sessionId: expect.any(String) }),
          child: expect.objectContaining({ sessionId: expect.any(String) }),
        });

      const targets = readyFrameTargets(frameEvents);
      expect(targets.main?.sessionId).not.toBe(targets.child?.sessionId);
      expect(targets.main?.targetId).not.toBe(targets.child?.targetId);

      const childTool = await waitForTool(page, IFRAME_TOOL_NAME);
      const invocation = await childTool.invoke({ input: IFRAME_TOOL_INPUT });
      await expect(invocation.result({ timeout: 5_000 })).resolves.toMatchObject({
        invocationId: invocation.invocationId,
        status: "Completed",
        output: {
          success: true,
          ...IFRAME_TOOL_INPUT,
        },
      });

      expect(await removeFirstIframe(page)).toBe(true);
      await expect
        .poll(
          async () => {
            try {
              await childTool.invoke({ input: IFRAME_TOOL_INPUT });
              return "invoked";
            } catch (error) {
              return error instanceof Error ? error.message : String(error);
            }
          },
          { timeout: 10_000, interval: 100 },
        )
        .toContain(`WebMCP frame "${childTool.frameId}" was not found`);
    } finally {
      await subscription.unsubscribe();
    }
  }, 45_000);
});

function readyFrameTargets(events: PageCDPEvent[]): {
  main?: PageCDPEvent;
  child?: PageCDPEvent;
} {
  return {
    main: events.find((event) => consoleArgument(event, 1) === "main"),
    child: events.find((event) => consoleArgument(event, 1) === "child"),
  };
}

function consoleArgument(event: PageCDPEvent, index: number): unknown {
  const args = event.params.args;
  if (!Array.isArray(args)) return undefined;
  const argument = args[index];
  if (argument === null || typeof argument !== "object" || Array.isArray(argument))
    return undefined;
  return "value" in argument ? argument.value : undefined;
}

async function waitForTool(
  page: Awaited<ReturnType<typeof firstPage>>,
  name: string,
): Promise<WebMCPTool> {
  let tool: WebMCPTool | undefined;
  await expect
    .poll(
      async () => {
        tool = (await page.tools({ timeout: 1_000 })).find((candidate) => candidate.name === name);
        return tool?.name;
      },
      { timeout: 10_000, interval: 100 },
    )
    .toBe(name);
  if (!tool) throw new Error(`WebMCP tool "${name}" was not discovered`);
  return tool;
}

async function removeFirstIframe(page: Awaited<ReturnType<typeof firstPage>>): Promise<boolean> {
  return await page.evaluate(() => {
    const iframe = document.querySelector("iframe");
    iframe?.remove();
    return iframe !== null;
  });
}
