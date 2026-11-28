import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { expect, it } from "vitest";

const entrypoint = fileURLToPath(new URL("../dist/facade/stdio-server.mjs", import.meta.url));
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

it("runs actions and captures screenshots through the default local stdio browser", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "stagehand-facade-browser-"));
  const client = new Client({ name: "stagehand-facade-browser-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint],
    env: {
      STAGEHAND_BROWSER: "local",
      STAGEHAND_FACADE_ARTIFACT_ROOT: directory,
      ...(process.env.CHROME_PATH && { CHROME_PATH: process.env.CHROME_PATH }),
    },
  });

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = CallToolResultSchema.parse(
      await client.callTool({ name, arguments: args }, undefined, { timeout: 15_000 }),
    );
    if (result.isError) throw new Error(JSON.stringify(result.content));
    return result.content;
  };
  const text = async (name: string, args: Record<string, unknown>) => {
    const [part] = await call(name, args);
    if (part?.type !== "text") throw new Error(`Expected text from ${name}`);
    return part.text;
  };
  const run = (code: string) => text("run", { code });

  try {
    await client.connect(transport);
    const html = `
      <title>Facade screenshot fixture</title>
      <body style="min-height: 1000px; background: coral">
        <button onclick="this.textContent = 'Clicked'">Click me</button>
      </body>`;
    const url = `data:text/html,${encodeURIComponent(html)}`;
    expect(
      await run(`
        await page.goto(${JSON.stringify(url)});
        await page.setViewportSize({ width: 800, height: 500 });
        return await page.evaluate(() => navigator.userAgent.includes("HeadlessChrome"));
      `),
    ).toBe("true");

    const snapshot = await text("snapshot", {});
    const buttonId = /\[(\d+-\d+)\] button: Click me/u.exec(snapshot)?.[1];
    expect(buttonId).toBeDefined();
    await call("run", { actions: [{ op: "click", id: buttonId }] });
    expect(await run('return await page.getByRole("button").textContent();')).toBe("Clicked");

    const viewport = (await call("screenshot", { type: "jpeg", quality: 40 })).find(
      (part) => part.type === "image",
    );
    expect(viewport?.mimeType).toBe("image/jpeg");
    expect(Buffer.from(viewport?.data ?? "", "base64").subarray(0, 3)).toEqual(
      Buffer.from([0xff, 0xd8, 0xff]),
    );

    await run(`
      const next = await context.newPage();
      await next.goto("about:blank");
      await page.screenshot({ path: "full-page.png", fullPage: true, timeout: 5000 });
    `);
    const fullPage = await readFile(path.join(directory, "full-page.png"));
    expect(fullPage.subarray(0, pngSignature.length)).toEqual(pngSignature);
    expect(fullPage.readUInt32BE(16)).toBe(800);
    expect(fullPage.readUInt32BE(20)).toBeGreaterThanOrEqual(1000);
  } finally {
    try {
      await client.close();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
}, 60_000);
