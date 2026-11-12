import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  localBrowser,
  Stagehand,
  type Page,
  type StagehandBrowser,
  type DecisionChooseParams,
  type DecisionChooseResult,
  type DecisionContext,
} from "../../src/index.js";

const fixture = new URL("../../../../tests/fixtures/prompt-locators/", import.meta.url);
const prompt = (value: string) => ({ type: "prompt" as const, value });

describe("prompt locators through the TypeScript SDK", () => {
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(
      await readFile(
        new URL(request.url?.startsWith("/frame.html") ? "frame.html" : "index.html", fixture),
      ),
    );
  });
  let browser: StagehandBrowser;
  let stagehand: Stagehand;
  let page: Page;
  let url: string;
  let temp: string;
  const requests: DecisionChooseParams[] = [];
  let choose: (
    request: DecisionChooseParams,
    context: DecisionContext,
  ) => Promise<DecisionChooseResult>;
  const select = async (request: DecisionChooseParams): Promise<DecisionChooseResult> => {
    const matches = request.candidates.filter((candidate) =>
      candidate.description.includes(`"${request.prompt}"`),
    );
    if (matches.length !== 1)
      throw new Error(
        `Expected one ${request.prompt} candidate: ${JSON.stringify(request.candidates)}`,
      );
    return { status: "selected", id: matches[0]!.id };
  };

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    temp = await mkdtemp(join(tmpdir(), "prompt-locators-"));
    browser = await localBrowser.launch({ headless: true, args: ["--site-per-process"] });
    stagehand = await Stagehand.create({
      browser,
      logging: { level: "off" },
      decisionModel: {
        choose: async (request, context) => {
          requests.push(structuredClone(request));
          return choose(request, context);
        },
      },
    });
    page = await browser.context.newPage();
  }, 60_000);
  beforeEach(async () => {
    requests.length = 0;
    choose = select;
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction("window.state.ready.length === 2");
  });
  afterAll(async () => {
    try {
      await stagehand?.close();
    } finally {
      await browser?.close();
    }
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    if (temp) await rm(temp, { recursive: true, force: true });
  });

  it("filters uploads, preserves file bytes and metadata, and clears selection", async () => {
    const resume = page.locator("#application").locator(prompt("Resume PDF"));
    await resume.setInputFiles({
      name: "resume.pdf",
      buffer: new Uint8Array([0, 255, 97]),
      mimeType: "application/pdf",
      lastModified: 123,
    });
    expect(requests[0]!.action).toBe("upload");
    expect(requests[0]!.candidates).toHaveLength(1);
    expect(requests[0]!.candidates[0]!.description).toContain('accept=".pdf"');
    expect(JSON.stringify(requests)).not.toContain("resume.pdf");
    expect(
      await page.evaluate(
        "(async () => { const f = document.querySelector('#resume').files[0]; return {name:f.name,type:f.type,lastModified:f.lastModified,bytes:[...new Uint8Array(await f.arrayBuffer())]}; })()",
      ),
    ).toEqual({
      name: "resume.pdf",
      type: "application/pdf",
      lastModified: 123,
      bytes: [0, 255, 97],
    });
    const path = join(temp, "from-path.pdf");
    await writeFile(path, "file path payload");
    await resume.setInputFiles(path);
    expect(await page.evaluate("document.querySelector('#resume').files[0].name")).toBe(
      "from-path.pdf",
    );
    await resume.setInputFiles([
      { name: "first.pdf", buffer: "first" },
      { name: "second.pdf", buffer: "second" },
    ]);
    expect(
      await page.evaluate("[...document.querySelector('#resume').files].map(f => f.name)"),
    ).toEqual(["first.pdf", "second.pdf"]);
    await resume.setInputFiles([]);
    expect(await page.evaluate("document.querySelector('#resume').files.length")).toBe(0);
  });

  it("executes native controls with the original action arguments", async () => {
    await page.locator(prompt("Applicant")).fill("Ada");
    await page.locator(prompt("Applicant")).type(" Lovelace", { delay: 1 });
    expect(await page.locator("#applicant").inputValue()).toBe("Ada Lovelace");
    expect(await page.locator(prompt("Plan")).selectOption("pro")).toEqual(["pro"]);
    expect(await page.locator(prompt("Addons")).selectOption(["a", "b"])).toEqual(["a", "b"]);
    await page.locator(prompt("Submit")).click();
    await page.locator(prompt("Event button")).sendClickEvent({ bubbles: false });
    await page.locator(prompt("Hover control")).hover();
    await page.locator(prompt("scroll-zone")).scrollTo(100);
    await page.waitForFunction("document.querySelector('#scroll-zone').scrollTop === 250");
    expect(
      await page.evaluate(
        "({clicks:state.clicks,eventClicks:state.eventClicks,hovered:state.hovered,scrolled:document.querySelector('#scroll-zone').scrollTop>0})",
      ),
    ).toEqual({ clicks: 1, eventClicks: 1, hovered: true, scrolled: true });
  });

  it.each(["same", "cross"])(
    "acts in the %s-origin iframe with and without a frame prefix",
    async (name) => {
      await page.locator(prompt(`${name}-field`)).fill(name);
      await page.waitForFunction(`window.state.frames.${name}?.value === "${name}"`);
      await page
        .locator(`#${name}`)
        .locator(prompt(`${name}-upload`))
        .setInputFiles({ name: `${name}.txt`, buffer: "frame bytes" });
      await page.waitForFunction(`window.state.frames.${name}?.files?.length === 1`);
      expect(await page.evaluate(`window.state.frames.${name}.files`)).toEqual([
        { name: `${name}.txt`, bytes: [...Buffer.from("frame bytes")] },
      ]);
      expect(requests.at(-1)!.candidates).toHaveLength(1);
    },
  );

  it.each(["open", "closed"])("acts inside %s shadow roots", async (mode) => {
    await page
      .locator(`#${mode}-host`)
      .locator(prompt(`${mode} field`))
      .fill(mode);
    expect(await page.evaluate(`window.shadowRoots.${mode}.querySelector('input').value`)).toBe(
      mode,
    );
    await page
      .locator(prompt(`${mode} upload`))
      .setInputFiles({ name: `${mode}.txt`, buffer: "shadow" });
    expect(
      await page.evaluate(
        `window.shadowRoots.${mode}.querySelector('input[type=file]').files[0].name`,
      ),
    ).toBe(`${mode}.txt`);
  });

  it("skips empty scopes but still asks the callback about a single candidate", async () => {
    await expect(page.locator("#empty").locator(prompt("Resume PDF")).click()).rejects.toThrow(
      "Could not find an element",
    );
    expect(requests).toEqual([]);
    choose = async () => ({ status: "no_match" });
    await expect(
      page.locator("#application").locator(prompt("Resume PDF")).setInputFiles([]),
    ).rejects.toThrow("Could not find an element");
    expect(requests).toHaveLength(1);
    expect(requests[0]!.candidates).toHaveLength(1);
  });

  it("keeps refusal and invalid IDs from dispatching an action", async () => {
    choose = async () => ({ status: "refused" });
    await expect(page.locator(prompt("Submit")).click()).rejects.toThrow("refused");
    // A real out-of-scope ID is still invalid, even though it was offered in another request.
    let outsideId = "";
    choose = async (request) => {
      outsideId = request.candidates.find((c) => c.description.includes('"Portrait"'))!.id;
      return { status: "no_match" };
    };
    await expect(page.locator(prompt("Portrait")).setInputFiles([])).rejects.toThrow(
      "Could not find",
    );
    choose = async () => ({ status: "selected", id: outsideId });
    await expect(
      page.locator("#application").locator(prompt("Resume PDF")).setInputFiles([]),
    ).rejects.toThrow("outside the supplied candidates");
    expect(await page.evaluate("window.state.clicks")).toBe(0);
    expect(await page.evaluate("document.querySelector('[name=portrait]').files.length")).toBe(0);
  });

  it("does not retarget a replacement node after selection", async () => {
    choose = async (request) => {
      const selected = await select(request);
      await page.evaluate(
        "const old = document.querySelector('[name=submit]'); const replacement = old.cloneNode(true); old.replaceWith(replacement)",
      );
      return selected;
    };
    await expect(page.locator(prompt("Submit")).click()).rejects.toThrow(
      "Prompt locator target is no longer attached",
    );
    expect(requests).toHaveLength(1);
    expect(await page.evaluate("window.state.clicks")).toBe(0);
  });

  it("cancels a timed-out decision and discards its late selection", async () => {
    const started = Promise.withResolvers<DecisionContext>();
    const completion = Promise.withResolvers<void>();
    choose = async (request, context) => {
      started.resolve(context);
      await completion.promise;
      return select(request);
    };
    const pending = page.locator(prompt("Submit")).click({ timeout: 1000 });
    const rejected = expect(pending).rejects.toThrow("timed out");
    const context = await started.promise;
    await rejected;
    await expect.poll(() => context.signal.aborted).toBe(true);
    completion.resolve();
    await page.evaluate("0");
    expect(await page.evaluate("window.state.clicks")).toBe(0);
  }, 10_000);
});
