import { afterAll, beforeAll, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import * as net from "node:net";
import { chromium, type Page } from "playwright";
import { Stagehand, localBrowser, type ClientLLM } from "@browserbasehq/stagehand";
import { recordNetwork, replayNetwork, type NetworkRecording } from "../../tasks/network.js";

// An act() regression whose outcome lives after the click: the plans only exist after a fetch,
// and choosing one POSTs and re-renders. A static observation has no scripts to run, so this is
// the case the network tier exists for. Model generation is the only thing substituted.
const PAGE = `<!doctype html><html><body>
  <button id="load">Load plans</button><div id="plans"></div><p id="status"></p>
  <script>
    document.getElementById("load").onclick = async () => {
      const plans = await (await fetch("/api/plans?_=" + Date.now())).json();
      document.getElementById("plans").innerHTML = plans
        .map((plan) => '<button data-plan="' + plan.id + '">Choose ' + plan.name + "</button>")
        .join("");
      for (const button of document.querySelectorAll("[data-plan]")) {
        button.onclick = async () => {
          const response = await fetch("/api/choose", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ plan: button.dataset.plan }),
          });
          document.getElementById("status").textContent = await response.text();
        };
      }
    };
  </script>
</body></html>`;

let server: Server;
let url: string;
let hits = 0;
let recording: NetworkRecording;

beforeAll(async () => {
  server = createServer((request, response) => {
    hits++;
    const path = new URL(request.url ?? "/", "http://x").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(PAGE);
    } else if (path === "/api/plans") {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify([
          { id: "basic", name: "Basic" },
          { id: "pro", name: "Pro" },
        ]),
      );
    } else if (path === "/api/choose") {
      let body = "";
      request.on("data", (chunk: Buffer) => (body += chunk));
      request.on("end", () => {
        const plan = JSON.parse(body).plan as string;
        response.end(`Subscribed to ${plan === "pro" ? "Pro" : "Basic"}`);
      });
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  url = `http://127.0.0.1:${address.port}/`;

  // The bug report: a person's session that loaded the plans and chose Pro.
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const recorder = await recordNetwork(page);
    await page.goto(url);
    await page.locator("#load").click();
    await page.getByRole("button", { name: "Choose Pro" }).click();
    await page.getByText("Subscribed to Pro").waitFor();
    recording = await recorder.stop();
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
});

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (!address || typeof address === "string") throw new Error("No free port");
  return address.port;
}

/** Run a real stagehand.act() against the replayed network; the model picks `target`. */
async function actOnReplay(target: string) {
  const model: ClientLLM = {
    generate: async (params) => {
      const format = params.responseFormat;
      if (format?.type !== "json_schema") throw new Error("Expected a structured act request");
      const prompt = params.messages
        .flatMap((message) =>
          (Array.isArray(message.content) ? message.content : [message.content]).map((content) =>
            typeof content === "string" ? content : content.type === "text" ? content.text : "",
          ),
        )
        .join("\n");
      // Read the element id from Stagehand's own observation of the replayed page: the button
      // only exists if the replayed /api/plans response reached the page's script.
      const elementId = prompt
        .split("\n")
        .find((line) => line.includes(`button: ${target}`))
        ?.match(/\[(\d+-\d+)\]/)?.[1];
      expect(elementId, `"${target}" missing from the observation`).toMatch(/^\d+-\d+$/);
      return {
        role: "assistant",
        content: { type: "text", text: "deterministic act" },
        outputFormat: "json_schema",
        structuredContent: {
          action: { elementId: elementId!, description: target, method: "click", arguments: [] },
          twoStep: false,
        },
      };
    },
  };
  const port = await freePort();
  const browser = await localBrowser.launch({ headless: true, port });
  const pw = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let stagehand: Stagehand | undefined;
  try {
    stagehand = await Stagehand.create({ browser, model, logging: { level: "off" } });
    const before = new Set(pw.contexts().flatMap((context) => context.pages()));
    const page = await browser.context.newPage();
    // The same tab, seen through Playwright, so the network replay can attach to its target.
    let replayed: Page | undefined;
    await expect
      .poll(
        () => {
          replayed = pw
            .contexts()
            .flatMap((context) => context.pages())
            .find((candidate) => !before.has(candidate));
          return Boolean(replayed);
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    const network = await replayNetwork(replayed!, recording);
    await page.goto(url);
    await page.locator("#load").click();
    await replayed!.getByRole("button", { name: "Choose Pro" }).waitFor();
    const result = await stagehand.act(`Click the ${target} button`, { page });
    await replayed!.waitForTimeout(300);
    return {
      result,
      status: await replayed!.locator("#status").textContent(),
      misses: network.misses,
    };
  } finally {
    try {
      await stagehand?.close();
    } finally {
      // Closing Playwright's CDP connection only detaches it; the browser is closed below.
      await pw.close().catch((): void => undefined);
      await browser.close();
    }
  }
}

test("act() reproduces the recorded post-click behavior with no live site", async () => {
  const before = hits;
  const { result, status, misses } = await actOnReplay("Choose Pro");
  expect(result.data.success).toBe(true);
  expect(status).toBe("Subscribed to Pro");
  expect(misses).toEqual([]);
  expect(hits, "the replay must never reach the original server").toBe(before);
});

test("a run that diverges from the recording surfaces as a miss, not a live request", async () => {
  const before = hits;
  const { status, misses } = await actOnReplay("Choose Basic");
  // Choosing Basic POSTs a body the bug report never sent: it fails instead of being answered.
  expect(misses.map((miss) => `${miss.method} ${new URL(miss.url).pathname}`)).toEqual([
    "POST /api/choose",
  ]);
  expect(status).toBe("");
  expect(hits).toBe(before);
});
