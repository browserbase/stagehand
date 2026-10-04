import { createServer } from "node:http";
import { expect, it, vi } from "vitest";
import { localBrowser, Stagehand, type StagehandBrowser } from "@browserbasehq/stagehand";
import { StagehandFacadeTools } from "../src/facade/tools.js";

type FrameState = {
  fixture: string;
  active: string;
  click: number;
  input: number;
  change: number;
  lastClick: string | null;
  scrollY: number;
  targetScroll: number;
  targetInView: boolean;
};

it("runs the shared facade against same-origin and out-of-process local frames", async () => {
  let port = 0;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (request.url === "/nested") {
      response.end("<button>Frame action</button>");
      return;
    }
    if (request.url === "/same" || request.url === "/cross") {
      const name = request.url === "/same" ? "Same value" : "Cross value";
      response.end(`
        <label>${name}<input id="value"></label>
        <button id="focus">Frame action</button>
        <div id="a"><button class="choice" id="first">First</button></div>
        <div id="b"><button class="choice" id="second">Second</button></div>
        <iframe src="/nested"></iframe><div id="shadow"></div>
        <div id="target" tabindex="0" style="margin-top:1800px;height:100px;overflow:auto">
          <div style="height:700px">Scrollable target</div>
        </div>
        <script>
          const events = {click: 0, input: 0, change: 0, lastClick: null};
          for (const type of ['click', 'input', 'change']) document.addEventListener(type, event => {
            events[type]++;
            if (type === 'click') events.lastClick = event.target.id;
          });
          document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML = '<button>Shadow-only action</button>';
          document.querySelector('#target').scrollTop = 45;
          addEventListener('message', event => {
            if (event.data !== 'inspect-fixture') return;
            const target = document.querySelector('#target');
            const rect = target.getBoundingClientRect();
            parent.postMessage({fixture: location.pathname, active: document.activeElement.id,
              ...events, scrollY, targetScroll: target.scrollTop,
              targetInView: rect.top >= 0 && rect.bottom <= innerHeight}, '*');
          });
        </script>`);
      return;
    }
    response.end(
      `<h1>Local frame fixture</h1><iframe id="same" height="350" src="/same"></iframe><iframe id="cross" height="350" src="http://localhost:${port}/cross"></iframe>`,
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // The fixture uses both 127.0.0.1 and localhost to force site isolation.
    // An unspecified bind accepts IPv4 and IPv6 localhost resolution.
    server.listen(0, resolve);
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
    const page = await stagehand.browser.context.activePage();
    if (!page) throw new Error("Missing local fixture page");
    const inspect = () =>
      page.evaluate(
        () =>
          new Promise<FrameState[]>((resolve, reject) => {
            const replies: FrameState[] = [];
            const timeout = setTimeout(() => {
              removeEventListener("message", listener);
              reject(new Error("Frame fixture did not report its state"));
            }, 2_000);
            const listener = (event: MessageEvent) => {
              if (!["/same", "/cross"].includes(event.data?.fixture)) return;
              replies.push(event.data as FrameState);
              if (replies.length === 2) {
                clearTimeout(timeout);
                removeEventListener("message", listener);
                resolve(replies.sort((a, b) => a.fixture.localeCompare(b.fixture)));
              }
            };
            addEventListener("message", listener);
            for (const frame of document.querySelectorAll("iframe"))
              frame.contentWindow?.postMessage("inspect-fixture", "*");
          }),
      );

    for (const id of ["same", "cross"]) {
      await tools.run(`await page.frameLocator("#${id}").locator("#focus").focus();`);
      const state = (await inspect()).find((state) => state.fixture === `/${id}`);
      expect(state).toMatchObject({ active: "focus", click: 0, input: 0, change: 0 });
    }
    for (const id of ["same", "cross"]) {
      await tools.run(
        `await page.frameLocator("#${id}").locator("#target").scrollIntoViewIfNeeded();`,
      );
    }
    for (const state of await inspect()) {
      expect(state.targetInView).toBe(true);
      expect(state.scrollY).toBeGreaterThan(0);
      expect(state.targetScroll).toBe(45);
      expect(state).toMatchObject({ click: 0, input: 0, change: 0 });
    }
    for (const id of ["same", "cross"]) {
      await expect(
        tools.run(`
        const frame = page.frameLocator("#${id}");
        const choices = frame.locator(".choice");
        return [await frame.getByRole("button", {name:"Frame action", exact:true}).count(),
          await (await choices.nth(1).all())[0].textContent(),
          await (await choices.last().all())[0].textContent()];
      `),
      ).resolves.toEqual([1, "Second", "Second"]);
      await tools.run(
        `await page.frameLocator("#${id}").locator("#a, #b").locator("button").nth(0).click();`,
      );
      await expect(
        tools.run(`return await page.frameLocator("#${id}").getByPlaceholder(/value/i).count();`),
      ).rejects.toThrow(/regular-expression attribute matching is not supported/);
      await tools.run(`await page.frameLocator("#${id}").locator("#value").fill("${id}-origin");`);
    }
    for (const state of await inspect()) expect(state.lastClick).toBe("first");
    await expect(
      tools.run(`return [await page.frameLocator("#same").locator("#value").inputValue(),
      await page.frameLocator("#cross").locator("#value").inputValue()];`),
    ).resolves.toEqual(["same-origin", "cross-origin"]);
    const snapshot = await tools.snapshot({ includeIframes: true });
    expect(snapshot).toContain("Same value");
    expect(snapshot).toContain("Cross value");
    expect(snapshot).toContain("Shadow-only action");
    // Confirm the cross-site frame really is an OOPIF, rather than assuming
    // that every cross-origin iframe has a distinct renderer process.
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
}, 60_000);
