import { createServer } from "node:http";
import { localBrowser, Stagehand, type StagehandBrowser } from "@browserbasehq/stagehand";
import { expect, it } from "vitest";
import { StagehandFacadeTools } from "../src/facade/tools.js";

it("drags through facade run code and releases the mouse on failure", async () => {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    const isFrame = request.url?.startsWith("/frame");
    const tall = request.url?.endsWith("/tall");
    const frameUrl = `http://localhost:${(server.address() as { port: number }).port}/frame${tall ? "/tall" : ""}`;
    response.end(`
      <style>
        #source, #target { display: inline-block; width: 100px; height: 100px; background: gray }
        #target { margin-left: 120px }
        ${isFrame && tall ? "#target { position: absolute; top: 1500px }" : ""}
      </style>
      <div id="source" draggable="true">Source</div><div id="target">Target</div>
      ${isFrame ? "" : `<iframe style="display:block; margin: 40px 0 0 70px; width: 440px; height: ${tall ? 1800 : 180}px; border: 8px solid; padding: 32px; transform: ${tall ? "none" : "scale(.8)"}" src="${frameUrl}"></iframe>`}
      <script>
        window.drops = 0;
        window.pressed = false;
        document.addEventListener("mousedown", () => { window.pressed = true; });
        document.addEventListener("mouseup", () => { window.pressed = false; });
        document.addEventListener("dragstart", (event) => {
          event.dataTransfer.setData("text/plain", "source");
        });
        document.addEventListener("dragend", () => { window.pressed = false; });
        window.addEventListener("message", (event) => {
          if (event.data === "frame-drop") window.drops++;
        });
        const target = document.querySelector("#target");
        target.addEventListener("dragover", (event) => event.preventDefault());
        target.addEventListener("drop", (event) => {
          event.preventDefault();
          if (event.dataTransfer.getData("text/plain") === "source") {
            window.drops++;
            if (window !== parent) parent.postMessage("frame-drop", "*");
          }
        });
      </script>
    `);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");

  let browser: StagehandBrowser | undefined;
  let stagehand: Stagehand | undefined;
  try {
    browser = await localBrowser.launch({
      headless: true,
      args: ["--site-per-process"],
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    });
    stagehand = await Stagehand.create({
      browser,
      model: {
        generate: async () => {
          throw new Error("Unexpected model call");
        },
      },
      logging: { level: "off" },
    });
    const tools = new StagehandFacadeTools(stagehand);
    await tools.run(`await page.goto("http://127.0.0.1:${address.port}/");`);
    const drops = () => tools.run("return await page.evaluate(() => window.drops);");
    await tools.run(
      `await page.locator("#source").dragTo(page.locator("#target"), { trial: true });`,
    );
    await expect(drops()).resolves.toBe(0);
    await tools.run(`await page.locator("#source").dragTo(page.locator("#target"));`);
    await expect(drops()).resolves.toBe(1);
    await tools.run(`
      const center = async (selector) => {
        const {x, y, width, height} = await page.locator(selector).boundingBox();
        return [x + width / 2, y + height / 2];
      };
      await page.mouse.move(...await center("#source"));
      await page.mouse.down();
      await page.mouse.move(...await center("#target"));
      await page.mouse.up();
    `);
    await expect(drops()).resolves.toBe(2);
    await tools.run(`
      const frame = page.frameLocator("iframe");
      await frame.locator("#source").dragTo(frame.locator("#target"), {
        sourcePosition: {x: 15, y: 15},
        targetPosition: {x: 15, y: 15},
      });
    `);
    await expect(drops()).resolves.toBe(3);
    await tools.run(`
      await page.evaluate(() => {
        const frame = document.querySelector("iframe");
        frame.remove();
        setTimeout(() => document.body.append(frame), 250);
      });
      const frame = page.frameLocator("iframe");
      await frame.locator("#source").dragTo(frame.locator("#target"), {
        trial: true,
        timeout: 2000,
      });
    `);
    await expect(drops()).resolves.toBe(3);
    await expect(
      tools.run(`await page.locator("#source").dragTo(page.locator("#source, #target"));`),
    ).rejects.toThrow(/locator.dragTo target: strict mode violation/);
    await expect(
      tools.run(`await page.dragAndDrop("#source, #target", "#target", { strict: true });`),
    ).rejects.toThrow(/locator.dragTo source: strict mode violation/);
    await tools.run(`
      await page.locator("#target").evaluate(el => {
        el.style.position = "absolute";
        el.style.top = "1600px";
      });
      await page.dragAndDrop("#source, #target", "#target");
    `);
    await expect(drops()).resolves.toBe(4);
    await tools.run("await page.evaluate(() => window.scrollTo(0, 0));");
    await expect(
      tools.run(
        `await page.locator("#source").dragTo(page.locator("#missing"), { timeout: 500 });`,
      ),
    ).rejects.toThrow(/timed out waiting for the target/);
    await expect(tools.run("return await page.evaluate(() => window.pressed);")).resolves.toBe(
      false,
    );
    await expect(
      tools.run(`
        await page.evaluate(() => {
          window.moves = [];
          document.addEventListener("pointermove", event => {
            if (event.buttons === 1) window.moves.push(event.clientX);
          });
        });
        await page.mouse.move(200, 40);
        await page.mouse.down();
        await page.mouse.move(260, 40, { steps: 3 });
        await page.mouse.up();
        return await page.evaluate(() => window.moves);
      `),
    ).resolves.toEqual([220, 240, 260]);
    await expect(
      tools.run(`
        await page.mouse.move(200, 40);
        await page.mouse.down();
        if (!await page.evaluate(() => window.pressed)) throw new Error("No mousedown");
        throw new Error("Interrupted");
      `),
    ).rejects.toThrow(/Interrupted/);
    await expect(tools.run("return await page.evaluate(() => window.pressed);")).resolves.toBe(
      false,
    );

    await tools.run(`await page.goto("http://127.0.0.1:${address.port}/tall");`);
    const frameDrag = `
      const frame = page.frameLocator("iframe");
      await frame.locator("#source").dragTo(frame.locator("#target"), { timeout: 2000 });
    `;
    await tools.run(frameDrag);
    await expect(drops()).resolves.toBe(1);
    await tools.run(
      `await page.locator("iframe").evaluate(el => el.style.transform = "scaleX(-1)");`,
    );
    await expect(tools.run(frameDrag)).rejects.toThrow(
      /iframe transforms must preserve axis direction/,
    );
    await expect(drops()).resolves.toBe(1);
  } finally {
    await stagehand?.close();
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
