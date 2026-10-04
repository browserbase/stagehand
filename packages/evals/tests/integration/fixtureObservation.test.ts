import { afterAll, beforeAll, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Stagehand, localBrowser, type ClientLLM } from "@browserbasehq/stagehand";
import { writeObservationFixture } from "../../fixtures/record.js";

const targetName = "Place order for Morgan Reed";
const hiddenName = "HIDDEN CANCEL ORDER";
let directory: string;
let server: Server;
let serverUrl: string;
let recordedHtml: string;
let lossyHtml: string;
let sourceAvailable = true;
const requests: string[] = [];

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "fixture-observation-"));
  const sourceHtml = await readFile(
    new URL("../../fixtures/examples/checkout.html", import.meta.url),
    "utf8",
  );
  server = createServer((request, response) => {
    const path = request.url ?? "/";
    requests.push(path);
    if (path === "/checkout.css" && sourceAvailable) {
      response.setHeader("content-type", "text/css");
      response.end(
        ".css-hidden { display: none; } main { max-width: 600px; } label { display: block; }",
      );
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (path === "/source" && sourceAvailable) response.end(sourceHtml);
    else if (path === "/recorded") response.end(recordedHtml);
    else if (path === "/lossy") response.end(lossyHtml);
    else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  serverUrl = `http://127.0.0.1:${address.port}`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`${serverUrl}/source`);
    await page.getByRole("button", { name: "Load saved checkout" }).click();
    await page.getByRole("button", { name: targetName }).waitFor();
    await writeObservationFixture(page, join(directory, "recorded"));
    recordedHtml = await readFile(join(directory, "recorded/index.html"), "utf8");
    // Deliberately remove a property required for observation fidelity. The
    // original CSS is unavailable on replay, so this reveals the hidden decoy.
    await page.setContent(recordedHtml);
    await page.locator("#decoy").evaluate((element) => element.removeAttribute("style"));
    lossyHtml = await page.content();
  } finally {
    await browser.close();
  }
});

afterAll(async () => {
  if (server)
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function observeCheckout(path: string) {
  let capturedPrompt = "";
  let calls = 0;
  const model: ClientLLM = {
    generate: async (params) => {
      calls++;
      capturedPrompt = params.messages
        .flatMap((message) =>
          (Array.isArray(message.content) ? message.content : [message.content])
            .filter((content) => content.type === "text")
            .map((content) => content.text),
        )
        .join("\n");
      // Inspect what Stagehand actually sends to inference, not page.innerHTML.
      expect(capturedPrompt, "hidden CSS control leaked into Stagehand observation").not.toContain(
        hiddenName,
      );
      expect(capturedPrompt).toContain("Express shipping: $12");
      const targetLine = capturedPrompt
        .split("\n")
        .find((line) => line.includes(`button: ${targetName}`));
      const elementId = targetLine?.match(/\[(\d+-\d+)\]/)?.[1];
      expect(elementId, "dynamic accessible button name was lost").toMatch(/^0-\d+$/);
      return {
        role: "assistant",
        content: { type: "text", text: "deterministic observation" },
        outputFormat: "json_schema",
        structuredContent: {
          elements: [
            { elementId: elementId!, description: targetName, method: "click", arguments: [] },
          ],
        },
      };
    },
  };
  const browser = await localBrowser.launch({ headless: true });
  let stagehand: Stagehand | undefined;
  try {
    stagehand = await Stagehand.create({ browser, model, logging: { level: "off" } });
    const page = await browser.context.newPage();
    await page.goto(`${serverUrl}${path}`);
    if (path === "/source") await page.locator("#prepare").click();
    const observed = await stagehand.observe("Find the button to place this order.", { page });
    expect(calls).toBe(1);
    expect(observed.data).toHaveLength(1);
    const selector = observed.data[0]!.selector;
    expect(selector).toMatch(/^xpath=/);
    expect(await page.locator(selector).isVisible()).toBe(true);
    // Verify the returned action resolves to the intended DOM control, and the
    // DOM-only form properties survive. No application action is replayed.
    const state = await page.evaluate((xpath) => {
      const control = document.evaluate(
        xpath.replace(/^xpath=/, ""),
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      ).singleNodeValue as Element;
      return {
        target: control.id,
        recipient: (document.querySelector("#recipient") as HTMLInputElement).value,
        gift: (document.querySelector("#gift") as HTMLInputElement).checked,
        shipping: (document.querySelector("#shipping") as HTMLSelectElement).value,
        expanded: (document.querySelector("#delivery") as HTMLDetailsElement).open,
      };
    }, selector);
    expect(state).toEqual({
      target: "submit",
      recipient: "Morgan Reed",
      gift: true,
      shipping: "Express",
      expanded: true,
    });
    return capturedPrompt.replace(/\[\d+-\d+\]/g, "[id]");
  } finally {
    try {
      await stagehand?.close();
    } finally {
      await browser.close();
    }
  }
}

test("offline recording preserves Stagehand's visible controls, accessible names, and edited state", async () => {
  const sourcePrompt = await observeCheckout("/source");
  sourceAvailable = false;
  requests.length = 0;
  try {
    const recordedPrompt = await observeCheckout("/recorded");
    expect(recordedPrompt).toBe(sourcePrompt);
    expect(requests).toEqual(["/recorded"]);
  } finally {
    sourceAvailable = true;
  }
});

test("observation validation detects loss of the captured CSS visibility", async () => {
  sourceAvailable = false;
  try {
    await expect(observeCheckout("/lossy")).rejects.toThrow(
      "hidden CSS control leaked into Stagehand observation",
    );
  } finally {
    sourceAvailable = true;
  }
});
