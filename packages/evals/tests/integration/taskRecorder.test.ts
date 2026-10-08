import { afterAll, beforeAll, expect, test } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { writeObservationTask } from "../../tasks/record.js";

let browser: Browser;
let server: Server;
let directory: string;
let url: string;
let page: Page;
const cliPath = fileURLToPath(new URL("../../tasks/cli.ts", import.meta.url));

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "observation-task-"));
  server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><html><head><style>.hidden {display:none} h1 {color:rgb(255, 0, 0)}</style></head><body>
      <h1>Inventory</h1><p class="hidden">Hidden text</p>
      <a href="/product">Product</a><label>Name<input id="name" value="old"></label>
      <input type="checkbox" id="check"><input type="password" value="secret">
      <textarea>old text</textarea><select><option>A</option><option>B</option></select>
      <button onclick="document.querySelector('h1').textContent='Updated'">Update</button>
      <script>window.sourceScript = true</script><img alt="Product photo" src="/photo.png">
    </body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  url = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
});

afterAll(async () => {
  await browser?.close();
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("captures the settled observation and replays without scripts or remote assets", async () => {
  await page.goto(url);
  await page.locator("#name").fill("edited");
  await page.locator("#check").check();
  await page.locator("textarea").fill("edited text");
  await page.locator("select").selectOption({ label: "B" });
  await page.getByRole("button", { name: "Update" }).click();
  const task = join(directory, "capture");
  await writeObservationTask(page, task);
  const manifest = JSON.parse(await readFile(join(task, "manifest.json"), "utf8"));
  expect(manifest).toMatchObject({
    version: 1,
    kind: "observation",
    sourceUrl: `${url}/`,
    viewport: { width: 1280, height: 720 },
  });
  const html = await readFile(join(task, "index.html"), "utf8");
  expect(html).not.toContain("secret");
  const replay = await browser.newPage();
  const requests: string[] = [];
  await replay.route("http://**/*", (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await replay.goto(pathToFileURL(join(task, "index.html")).href);
  expect(await replay.getByRole("heading").textContent()).toBe("Updated");
  expect(await replay.locator("h1").evaluate((element) => getComputedStyle(element).color)).toBe(
    "rgb(255, 0, 0)",
  );
  expect(await replay.locator(".hidden").isVisible()).toBe(false);
  expect(await replay.getByRole("link").getAttribute("href")).toBe(`${url}/product`);
  expect(await replay.locator("#name").inputValue()).toBe("edited");
  expect(await replay.locator("#check").isChecked()).toBe(true);
  expect(await replay.locator("textarea").inputValue()).toBe("edited text");
  expect(await replay.locator("select").inputValue()).toBe("B");
  expect(await replay.locator("script, [onclick], img[src]").count()).toBe(0);
  // CSP must also block resource URLs introduced after the HTML is loaded.
  await replay.evaluate(async (sourceUrl) => {
    await new Promise<void>((resolve) => {
      const image = document.createElement("img");
      image.onload = image.onerror = () => resolve();
      image.src = `${sourceUrl}/should-be-blocked.png`;
      document.body.append(image);
    });
  }, url);
  expect(requests).toEqual([]);
  expect(await page.locator("script").count()).toBe(1);
  expect(await page.locator("#name").inputValue()).toBe("edited");
  await replay.close();
});

test("never overwrites an existing task", async () => {
  await page.goto(url);
  const task = join(directory, "exclusive");
  await writeObservationTask(page, task);
  const original = await readFile(join(task, "index.html"), "utf8");
  await expect(writeObservationTask(page, task)).rejects.toThrow();
  expect(await readFile(join(task, "index.html"), "utf8")).toBe(original);
});

test.each(["frame", "shadow"])(
  "rejects unsupported %s content before creating output",
  async (kind) => {
    await page.goto(url);
    await page.evaluate((type) => {
      if (type === "frame") document.body.append(document.createElement("iframe"));
      else
        document.body
          .appendChild(document.createElement("div"))
          .attachShadow({ mode: "open" }).innerHTML = "<button>shadow</button>";
    }, kind);
    const output = join(directory, `unsupported-${kind}`);
    await expect(writeObservationTask(page, output)).rejects.toThrow(
      "do not support frames or shadow DOM",
    );
    await expect(readFile(join(output, "index.html"))).rejects.toThrow();
  },
);

test("CLI help advertises task recording", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--import",
    "tsx",
    cliPath,
    "--help",
  ]);
  expect(stdout).toContain("task:record --url");
  expect(stdout).not.toContain("fixture");
});

test("CLI runs setup and produces a task; invalid setup fails without output", async () => {
  const setup = join(directory, "setup.mjs");
  await writeFile(
    setup,
    `export default async function(page) { await page.getByRole("button", { name: "Update" }).click(); }`,
  );
  const output = join(directory, "cli");
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--import",
    "tsx",
    cliPath,
    "--url",
    url,
    "--out",
    output,
    "--setup",
    setup,
  ]);
  expect(stdout).toContain(`Recorded observation task in ${output}`);
  expect(await readFile(join(output, "index.html"), "utf8")).toContain(">Updated</h1>");
  await writeFile(setup, "export default 123;");
  await expect(
    promisify(execFile)(process.execPath, [
      "--import",
      "tsx",
      cliPath,
      "--url",
      url,
      "--out",
      join(directory, "invalid"),
      "--setup",
      setup,
    ]),
  ).rejects.toThrow("Setup module must default-export");
  await expect(readFile(join(directory, "invalid", "index.html"))).rejects.toThrow();
});
