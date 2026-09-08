import { createServer } from "node:http";
import { expect, it, vi } from "vitest";
import { localBrowser, Stagehand, type StagehandBrowser } from "@browserbasehq/stagehand";
import { StagehandFacadeTools } from "../src/facade/tools.js";

it("runs the shared facade against same-origin and out-of-process local frames", async () => {
  let port = 0;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    const body =
      request.url === "/same"
        ? "<label>Same value<input></label>"
        : request.url === "/cross"
          ? "<label>Cross value<input></label>"
          : `<h1>Local frame fixture</h1><iframe id="same" src="/same"></iframe><iframe id="cross" src="http://localhost:${port}/cross"></iframe>`;
    response.end(body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  port = (server.address() as { port: number }).port;
  let browser: StagehandBrowser | undefined;
  let stagehand: Stagehand | undefined;
  const generate = vi.fn(async (): Promise<never> => {
    throw new Error("This local fixture must not call a model");
  });
  try {
    browser = await localBrowser.launch({ headless: true, args: ["--site-per-process"] });
    stagehand = await Stagehand.create({ browser, model: { generate }, logging: { level: "off" } });
    const tools = new StagehandFacadeTools(stagehand);
    await tools.run(`await page.goto(${JSON.stringify(`http://127.0.0.1:${port}/`)});`);
    await tools.run(`
      await page.frameLocator("#same").locator("input").fill("same-origin");
      await page.frameLocator("#cross").locator("input").fill("cross-origin");
    `);
    await expect(
      tools.run(
        `return [await page.frameLocator("#same").locator("input").inputValue(), await page.frameLocator("#cross").locator("input").inputValue()];`,
      ),
    ).resolves.toEqual(["same-origin", "cross-origin"]);
    const snapshot = await tools.snapshot({ includeIframes: true });
    expect(snapshot).toContain("Same value");
    expect(snapshot).toContain("Cross value");
    // Test-only transport inspection confirms the cross-site frame is an OOPIF,
    // rather than assuming that every cross-origin iframe has its own process.
    const transport = stagehand.rpcClient.cdp as unknown as {
      sendCommand(method: string): Promise<{ targetInfos: Array<{ type: string; url: string }> }>;
    };
    const { targetInfos } = await transport.sendCommand("Target.getTargets");
    expect(
      targetInfos.some(
        (target) => target.type === "iframe" && target.url === `http://localhost:${port}/cross`,
      ),
    ).toBe(true);
    expect(generate).not.toHaveBeenCalled();
    expect(tools.sessionLoss).toBeUndefined();
  } finally {
    try {
      await stagehand?.close();
    } finally {
      try {
        await browser?.close();
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  }
}, 45_000);
