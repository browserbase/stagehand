import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  UnderstudyRuntime,
  type UnderstudyRuntimeOptions,
} from "./understudy-runtime.js";

function formatText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function createTextResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: formatText(value) }],
    structuredContent:
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : undefined,
  };
}

export interface StartUnderstudyMcpServerOptions
  extends UnderstudyRuntimeOptions {}

export async function startUnderstudyMcpServer(
  options: StartUnderstudyMcpServerOptions,
): Promise<void> {
  const runtime = new UnderstudyRuntime(options);
  const server = new McpServer({
    name: "multiagent-understudy",
    version: "0.1.0",
  });

  const shutdown = async () => {
    await runtime.stop();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });

  server.tool(
    "understudy_new_page",
    "Create a new top-level page and make it the active page.",
    {
      url: z
        .string()
        .optional()
        .describe("Optional URL to open in the new page."),
    },
    async ({ url }) => {
      const page = await runtime.newPage(url);
      return createTextResult({
        url: page.url(),
        title: await page.title(),
      });
    },
  );

  server.tool(
    "understudy_goto",
    "Navigate the active page to a URL using Understudy.",
    {
      url: z.string().url().describe("The destination URL."),
      waitUntil: z
        .enum(["load", "domcontentloaded", "networkidle"])
        .optional()
        .describe("Lifecycle state to wait for before returning."),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Navigation timeout in milliseconds."),
    },
    async ({ url, waitUntil, timeoutMs }) => {
      return createTextResult(
        await runtime.goto({
          url,
          waitUntil,
          timeoutMs,
        }),
      );
    },
  );

  server.tool(
    "understudy_get_url",
    "Get the active page URL.",
    {},
    async () => createTextResult({ url: await runtime.getUrl() }),
  );

  server.tool(
    "understudy_get_title",
    "Get the active page title.",
    {},
    async () => createTextResult({ title: await runtime.getTitle() }),
  );

  server.tool(
    "understudy_screenshot",
    "Capture a screenshot of the active page.",
    {
      type: z
        .enum(["png", "jpeg"])
        .optional()
        .describe("Image format for the screenshot."),
      fullPage: z
        .boolean()
        .optional()
        .describe("Capture the full scrollable page instead of the viewport."),
      quality: z
        .number()
        .int()
        .min(0)
        .max(100)
        .optional()
        .describe("JPEG quality from 0-100. Only applies to jpeg."),
      path: z
        .string()
        .optional()
        .describe("Optional file path to save the screenshot to."),
      omitBackground: z
        .boolean()
        .optional()
        .describe("Use a transparent background when supported."),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Screenshot timeout in milliseconds."),
    },
    async ({ type, fullPage, quality, path, omitBackground, timeoutMs }) => {
      return createTextResult(
        await runtime.screenshot({
          type,
          fullPage,
          quality,
          path,
          omitBackground,
          timeoutMs,
        }),
      );
    },
  );

  server.tool(
    "understudy_snapshot",
    "Capture an Understudy snapshot of the active page for DOM-aware browsing.",
    {
      includeIframes: z
        .boolean()
        .optional()
        .describe("Whether to include iframe contents in the snapshot."),
    },
    async ({ includeIframes }) => {
      return createTextResult(
        await runtime.snapshot({
          includeIframes,
        }),
      );
    },
  );

  server.tool(
    "understudy_click",
    "Click at viewport coordinates on the active page.",
    {
      x: z.number().describe("Viewport x coordinate in CSS pixels."),
      y: z.number().describe("Viewport y coordinate in CSS pixels."),
      button: z
        .enum(["left", "right", "middle"])
        .optional()
        .describe("Mouse button to use."),
      clickCount: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Number of sequential clicks to dispatch."),
      returnXpath: z
        .boolean()
        .optional()
        .describe("Return the resolved XPath for the hit target when possible."),
    },
    async ({ x, y, button, clickCount, returnXpath }) => {
      return createTextResult(
        await runtime.click({
          x,
          y,
          button,
          clickCount,
          returnXpath,
        }),
      );
    },
  );

  server.tool(
    "understudy_type",
    "Type text into the currently focused element on the active page.",
    {
      text: z.string().describe("Text to type."),
      delay: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Optional delay between keystrokes in milliseconds."),
      withMistakes: z
        .boolean()
        .optional()
        .describe("Whether to simulate occasional typos and corrections."),
    },
    async ({ text, delay, withMistakes }) => {
      await runtime.type({
        text,
        delay,
        withMistakes,
      });
      return createTextResult({ ok: true });
    },
  );

  server.tool(
    "understudy_key_press",
    "Press a single key or key combination on the active page.",
    {
      key: z
        .string()
        .describe("Key or combination like Enter, Tab, Cmd+A, Ctrl+C."),
      delay: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Optional delay between key down and key up."),
    },
    async ({ key, delay }) => {
      await runtime.keyPress({
        key,
        delay,
      });
      return createTextResult({ ok: true });
    },
  );

  server.tool(
    "understudy_wait_for_selector",
    "Wait for a selector to reach a target state on the active page.",
    {
      selector: z
        .string()
        .describe("Selector to wait for. Supports iframe hop notation."),
      state: z
        .enum(["attached", "detached", "visible", "hidden"])
        .optional()
        .describe("Desired selector state."),
      timeout: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum time to wait in milliseconds."),
      pierceShadow: z
        .boolean()
        .optional()
        .describe("Whether to pierce shadow DOM while resolving the selector."),
    },
    async ({ selector, state, timeout, pierceShadow }) => {
      return createTextResult({
        matched: await runtime.waitForSelector({
          selector,
          state,
          timeout,
          pierceShadow,
        }),
      });
    },
  );

  server.tool(
    "understudy_wait_for_timeout",
    "Sleep for a fixed amount of time on the active page session.",
    {
      ms: z
        .number()
        .int()
        .min(0)
        .describe("Milliseconds to wait."),
    },
    async ({ ms }) => {
      await runtime.waitForTimeout(ms);
      return createTextResult({ ok: true, waitedMs: ms });
    },
  );

  server.tool(
    "understudy_scroll",
    "Dispatch a wheel scroll gesture at viewport coordinates.",
    {
      x: z.number().describe("Viewport x coordinate in CSS pixels."),
      y: z.number().describe("Viewport y coordinate in CSS pixels."),
      deltaX: z.number().describe("Horizontal wheel delta."),
      deltaY: z.number().describe("Vertical wheel delta."),
      returnXpath: z
        .boolean()
        .optional()
        .describe("Return the resolved XPath for the hit target when possible."),
    },
    async ({ x, y, deltaX, deltaY, returnXpath }) => {
      return createTextResult(
        await runtime.scroll({
          x,
          y,
          deltaX,
          deltaY,
          returnXpath,
        }),
      );
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
