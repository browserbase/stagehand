import { afterAll, beforeAll, expect, test } from "vitest";
import { chromium, type Browser } from "playwright";
import { createServer, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type NetworkRecording,
  readNetworkTask,
  recordNetwork,
  replayNetwork,
  requestKey,
  writeNetworkTask,
} from "../../tasks/network.js";

// A page whose behavior lives after the click: every handler fetches, then re-renders.
const PAGE = `<!doctype html><html><body>
  <ul id="items"></ul><p id="saved"></p><p id="count"></p><p id="zipped"></p>
  <button id="save-a">Save A</button><button id="save-b">Save B</button>
  <button id="refresh">Refresh</button>
  <script>
    const save = (name) => fetch("/api/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) })
      .then((r) => r.text()).then((t) => (document.getElementById("saved").textContent = t));
    fetch("/api/items?_=" + Date.now() + "&b=2&a=1").then((r) => r.json()).then((items) => {
      document.getElementById("items").innerHTML = items.map((i) => "<li>" + i + "</li>").join("");
    });
    fetch("/api/zipped").then((r) => r.text()).then((t) => (document.getElementById("zipped").textContent = t));
    document.getElementById("save-a").onclick = () => save("A");
    document.getElementById("save-b").onclick = () => save("B");
    document.getElementById("refresh").onclick = () =>
      fetch("/api/counter").then((r) => r.text()).then((t) => (document.getElementById("count").textContent = t));
  </script>
</body></html>`;

let browser: Browser;
let server: Server;
let directory: string;
let url: string;
let hits = 0;
let counter = 0;
const cliPath = fileURLToPath(new URL("../../tasks/cli.ts", import.meta.url));

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "network-task-"));
  server = createServer((request, response) => {
    hits++;
    const path = new URL(request.url ?? "/", "http://x").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(PAGE);
    } else if (path === "/api/items") {
      response.setHeader("content-type", "application/json");
      response.setHeader("set-cookie", "session=secret-session-token; Path=/");
      response.end(JSON.stringify(["Alpha", "Beta"]));
    } else if (path === "/api/zipped") {
      response.setHeader("content-type", "text/plain");
      response.setHeader("content-encoding", "gzip");
      response.end(gzipSync("decompressed body"));
    } else if (path === "/api/slow") {
      setTimeout(() => response.end("slow body"), 400);
    } else if (path === "/api/counter") {
      response.end(`count ${++counter}`);
    } else if (path === "/api/save") {
      let body = "";
      request.on("data", (chunk: Buffer) => (body += chunk));
      request.on("end", () => response.end(`saved ${JSON.parse(body).name}`));
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  url = `http://127.0.0.1:${address.port}/`;
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  if (server)
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("match keys ignore cache busters and parameter order, and include the request body", () => {
  const get = (u: string) => requestKey({ url: u, method: "GET" });
  expect(get("http://x/a?_=1&b=2&a=1#frag")).toBe(get("http://x/a?a=1&b=2&_=999"));
  expect(get("http://x/a?a=1")).not.toBe(get("http://x/a?a=2"));
  const post = (body: string) =>
    requestKey({ url: "http://x/graphql", method: "POST", postData: body });
  expect(post('{"op":"A"}')).not.toBe(post('{"op":"B"}'));
  expect(post('{"op":"A"}')).toBe(
    requestKey({
      url: "http://x/graphql",
      method: "POST",
      postDataEntries: [{ bytes: Buffer.from('{"op":"A"}').toString("base64") }],
    }),
  );
});

test("records what the page received and replays it to the page's own scripts, offline", async () => {
  const page = await browser.newPage();
  const recorder = await recordNetwork(page);
  await page.goto(url);
  await page.getByText("Beta").waitFor();
  await page.getByText("decompressed body").waitFor();
  await page.locator("#save-a").click();
  await page.getByText("saved A").waitFor();
  await page.locator("#refresh").click();
  await page.getByText("count 1").waitFor();
  await page.locator("#refresh").click();
  await page.getByText("count 2").waitFor();
  const recording = await recorder.stop();
  await page.close();

  const task = join(directory, "recorded");
  await writeNetworkTask(recording, task, { sourceUrl: url, viewport: null });
  const stored = await readFile(join(task, "responses.json"), "utf8");
  expect(stored).not.toContain("secret-session-token");
  expect(stored.toLowerCase()).not.toContain("content-encoding");
  expect(JSON.parse(await readFile(join(task, "manifest.json"), "utf8"))).toMatchObject({
    version: 1,
    kind: "network",
    sourceUrl: url,
  });

  const before = hits;
  const replay = await browser.newPage();
  const network = await replayNetwork(replay, await readNetworkTask(task));
  await replay.goto(url);
  // A new Date.now() cache buster still matches; the gzip body was stored decoded.
  await replay.getByText("Beta").waitFor();
  await replay.getByText("decompressed body").waitFor();
  await replay.locator("#save-a").click();
  await replay.getByText("saved A").waitFor();
  // Repeated requests get the recorded responses in order, then the last one repeats.
  for (const expected of ["count 1", "count 2", "count 2"]) {
    await replay.locator("#refresh").click();
    await replay.getByText(expected).waitFor();
  }
  expect(network.misses).toEqual([]);
  expect(hits, "replay must never reach the original server").toBe(before);

  // A request the original run never made fails instead of reaching the network.
  await replay.locator("#save-b").click();
  const unrecorded = await replay.evaluate(() =>
    fetch("/api/unrecorded").then(
      () => "answered",
      () => "failed",
    ),
  );
  expect(unrecorded).toBe("failed");
  await expect
    .poll(() => network.misses.map((miss) => `${miss.method} ${new URL(miss.url).pathname}`))
    .toEqual(["POST /api/save", "GET /api/unrecorded"]);
  expect(await replay.locator("#saved").textContent()).toBe("saved A");
  expect(hits).toBe(before);
  await network.stop();
  await replay.close();
});

test("stop() waits for requests still in flight", async () => {
  const page = await browser.newPage();
  const recorder = await recordNetwork(page);
  await page.goto(url);
  // Fire a slow request and stop at once: its response must still be in the recording.
  await page.evaluate(() => {
    void fetch("/api/slow");
  });
  const recording = await recorder.stop();
  await page.close();
  const slow = recording.responses.find((response) => response.url.endsWith("/api/slow"));
  expect(slow && Buffer.from(slow.body, "base64").toString()).toBe("slow body");
});

test("never overwrites an existing network task", async () => {
  const task = join(directory, "exclusive");
  const recording: NetworkRecording = { version: 1, ignoredParams: [], responses: [] };
  await writeNetworkTask(recording, task, { sourceUrl: url, viewport: null });
  await expect(
    writeNetworkTask(recording, task, { sourceUrl: url, viewport: null }),
  ).rejects.toThrow();
});

test("CLI --network records responses through setup", async () => {
  const output = join(directory, "cli-network");
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--import",
    "tsx",
    cliPath,
    "--url",
    url,
    "--out",
    output,
    "--network",
  ]);
  expect(stdout).toMatch(/Recorded network task \(\d+ responses\)/);
  const recording = await readNetworkTask(output);
  expect(recording.responses.map((response) => new URL(response.url).pathname)).toEqual(
    expect.arrayContaining(["/", "/api/items", "/api/zipped"]),
  );
  const help = await promisify(execFile)(process.execPath, ["--import", "tsx", cliPath, "--help"]);
  expect(help.stdout).toContain("--network");
});
