import { Page } from "../../src/page.js";
import { serializeClientLocatorOptions } from "../../src/clientLocatorOptions.js";
import { createServer, type Server } from "node:http";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";
import { STAGEHAND_PROTOCOL_VERSION } from "@browserbasehq/stagehand-protocol/schemas";
import type { StagehandRpcNotification } from "@browserbasehq/stagehand-protocol/types";
import { launchLocalBrowser } from "../../src/browser/localBrowser.js";
import { connectRPCClient, type RPCClient } from "../../src/rpcClient.js";

const stagehandExtensionDistDir = new URL("../../../extension/dist", import.meta.url).pathname;

type FixtureServer = {
  url: string;
  close(): Promise<void>;
};

type LaunchedLocalBrowser = Awaited<ReturnType<typeof launchLocalBrowser>>;

describe("Stagehand service worker RPC client smoke", () => {
  let extensionDir: string | undefined;
  let fixtureServer: FixtureServer | undefined;
  let chrome: LaunchedLocalBrowser | undefined;
  let rpcClient: RPCClient | undefined;
  const bufferedInitNotifications: StagehandRpcNotification[] = [];

  beforeAll(async () => {
    extensionDir = await createFullGraphSmokeExtension();
    fixtureServer = await startFixtureServer();
    const signal = AbortSignal.timeout(60_000);
    chrome = await launchLocalBrowser({ headless: true }, signal);
    rpcClient = await connectRPCClient({
      cdpUrl: chrome.cdpUrl,
      extensionDir,
      serviceWorkerUrlIncludes: "service-worker.js",
      signal,
    });
    await rpcClient.sendStagehandInit(
      {
        protocolVersion: STAGEHAND_PROTOCOL_VERSION,
        clientInfo: { name: "stagehand-sdk-ts", version: "4.0.0" },
        logLevel: "debug",
        model: { source: "client" },
        browserCdpUrl: rpcClient.browserWebSocketDebuggerUrl ?? chrome.cdpUrl,
      },
      signal,
    );
    const stopCapturingInitNotifications = rpcClient.onNotification((notification) => {
      bufferedInitNotifications.push(notification);
    });
    stopCapturingInitNotifications();
    const pages = await rpcClient.send(StagehandMethods.contextPages, {}, { signal });
    const page =
      pages[0] ?? (await rpcClient.send(StagehandMethods.contextNewPage, {}, { signal }));
    await rpcClient.send(
      StagehandMethods.pageGoto,
      { pageId: page.pageId, url: fixtureServer.url },
      { signal },
    );
  }, 70_000);

  afterAll(async () => {
    rpcClient?.close();
    await chrome?.close();
    await fixtureServer?.close();
    if (extensionDir) await rm(extensionDir, { force: true, recursive: true });
  });

  it("discovers the Stagehand service worker in a real Chromium session", () => {
    expect(rpcClient?.serviceWorker.url).toContain("chrome-extension://");
    expect(rpcClient?.serviceWorker.url).toContain("/service-worker.js");
    expect(rpcClient?.serviceWorker.extensionId).toBeTruthy();
  });

  it("buffers Stagehand logs until the SDK notification listener is attached", () => {
    expect(bufferedInitNotifications).toContainEqual({
      jsonrpc: "2.0",
      method: "stagehand.log",
      params: {
        level: "info",
        message: "stagehand.init",
        data: {},
      },
    });
  });

  it("streams validated Stagehand log notifications over the existing CDP connection", async () => {
    const notifications: StagehandRpcNotification[] = [];
    const activeRpcClient = requireRpcClient(rpcClient);
    const stopListening = activeRpcClient.onNotification((notification) => {
      notifications.push(notification);
    });

    await activeRpcClient.send(StagehandMethods.contextPages, {});

    expect(notifications).toContainEqual({
      jsonrpc: "2.0",
      method: "stagehand.log",
      params: {
        level: "debug",
        message: "context.pages",
        data: {},
      },
    });
    stopListening();
  });

  it("context.pages returns PageRefs from the understudy context", async () => {
    const pages = await requireRpcClient(rpcClient).send(StagehandMethods.contextPages, {});

    expect(pages.length).toBeGreaterThanOrEqual(1);
    expect(pages[0]?.pageId).toBeTruthy();
    expect(pages[0]?.url).toContain(requireFixtureServer(fixtureServer).url);
  });

  it("context.new_page returns a PageRef from the understudy context", async () => {
    const page = await requireRpcClient(rpcClient).send(StagehandMethods.contextNewPage, {
      url: "about:blank",
    });

    expect(page.pageId).toBeTruthy();
    expect(page.url).toBe("about:blank");
  });

  it("supports locators on a newly created page before its first navigation", async () => {
    const activeRpcClient = requireRpcClient(rpcClient);
    const page = await activeRpcClient.send(StagehandMethods.contextNewPage, {});

    try {
      expect(page.url).toBe(
        `chrome-extension://${activeRpcClient.serviceWorker.extensionId}/blank.html`,
      );
      await activeRpcClient.send(StagehandMethods.pageEvaluate, {
        pageId: page.pageId,
        expression: `(() => {
          const button = document.createElement("button");
          button.id = "blank-page-button";
          button.textContent = "Continue";
          button.addEventListener("click", () => {
            button.textContent = "Clicked";
          });
          document.body.appendChild(button);
        })()`,
      });

      await expect(
        activeRpcClient.send(StagehandMethods.locatorClick, {
          pageId: page.pageId,
          selector: { type: "legacy" as const, value: "#blank-page-button" },
        }),
      ).resolves.toStrictEqual({ clicked: true });
      await expect(
        activeRpcClient.send(StagehandMethods.locatorTextContent, {
          pageId: page.pageId,
          selector: { type: "legacy" as const, value: "#blank-page-button" },
        }),
      ).resolves.toBe("Clicked");
    } finally {
      await activeRpcClient.send(StagehandMethods.pageClose, { pageId: page.pageId });
    }
  });

  it("resolves explicit selectors without parsing their values as legacy expressions", async () => {
    const client = requireRpcClient(rpcClient);
    const page = await client.send(StagehandMethods.contextNewPage, {});
    try {
      await client.send(StagehandMethods.pageEvaluate, {
        pageId: page.pageId,
        expression: `(() => {
          const button = document.createElement("button");
          button.id = "typed-target";
          button.setAttribute("data-label", "a >> b");
          button.textContent = 'text="Pay" >> now';
          document.body.appendChild(button);
        })()`,
      });

      for (const selector of [
        { type: "css", value: '[data-label="a >> b"]' },
        { type: "xpath", value: './/button[@id="typed-target"]' },
        { type: "text", value: 'text="Pay" >> now' },
      ] as const) {
        await expect(
          client.send(StagehandMethods.locatorTextContent, { pageId: page.pageId, selector }),
        ).resolves.toBe('text="Pay" >> now');
      }
    } finally {
      await client.send(StagehandMethods.pageClose, { pageId: page.pageId });
    }
  });

  it("resolves scoped chains, intermediate indices, and overlapping roots", async () => {
    const client = requireRpcClient(rpcClient);
    const page = await client.send(StagehandMethods.contextNewPage, {
      url: requireFixtureServer(fixtureServer).url + "chains",
    });
    const query = (type: "css" | "xpath" | "text", value: string, nth?: number) => ({
      type: "query" as const,
      selector: { type, value },
      ...(nth === undefined ? {} : { nth }),
    });
    try {
      for (const step of [
        query("text", "Pay"),
        query("xpath", ".//button"),
        query("xpath", "//button"),
        query("css", "button"),
      ]) {
        await expect(
          client.send(StagehandMethods.locatorTextContent, {
            pageId: page.pageId,
            selector: { steps: [query("css", ".card", 1), step] },
          }),
        ).resolves.toBe("Pay second");
      }
      await expect(
        client.send(StagehandMethods.locatorCount, {
          pageId: page.pageId,
          selector: { steps: [query("css", ".card, .nested"), query("css", "button")] },
        }),
      ).resolves.toBe(2);
      await expect(
        client.send(StagehandMethods.locatorCount, {
          pageId: page.pageId,
          selector: { steps: [query("css", ".card", 10), query("css", "button")] },
        }),
      ).resolves.toBe(0);
      await expect(
        client.send(StagehandMethods.locatorCount, {
          pageId: page.pageId,
          selector: { steps: [query("css", ".card"), query("css", "button", 1)] },
        }),
      ).resolves.toBe(1);
      await expect(
        client.send(StagehandMethods.locatorTextContent, {
          pageId: page.pageId,
          selector: { steps: [query("css", "#chain-shadow"), query("text", "Shadow pay")] },
        }),
      ).resolves.toBe("Shadow pay");
      await expect(
        client.send(StagehandMethods.locatorTextContent, {
          pageId: page.pageId,
          selector: { steps: [query("css", "#chain-shadow"), query("xpath", ".//button")] },
        }),
      ).resolves.toBe("Shadow pay");
      await client.send(StagehandMethods.locatorSendClickEvent, {
        pageId: page.pageId,
        selector: { steps: [query("css", ".card", 1), query("text", "Pay")] },
      });
      await expect(
        client.send(StagehandMethods.locatorTextContent, {
          pageId: page.pageId,
          selector: { steps: [query("css", ".card", 1), query("css", "button")] },
        }),
      ).resolves.toBe("Paid second");
      await expect(
        client.send(StagehandMethods.locatorCount, {
          pageId: page.pageId,
          selector: {
            steps: [
              query("css", ".card"),
              { type: "frame", selector: { type: "css", value: "button" } },
            ],
          },
        }),
      ).rejects.toThrow(/frame step requires/i);
      await expect(
        client.send(StagehandMethods.locatorCount, {
          pageId: page.pageId,
          selector: { steps: [{ type: "frame", selector: { type: "css", value: "button" } }] },
        }),
      ).rejects.toThrow(/preceding iframe/i);
    } finally {
      await client.send(StagehandMethods.pageClose, { pageId: page.pageId });
    }
  }, 30_000);

  it("enters same-origin and cross-origin frames and masks every chain match", async () => {
    const client = requireRpcClient(rpcClient);
    const page = await client.send(StagehandMethods.contextNewPage, {
      url: requireFixtureServer(fixtureServer).url + "chains",
    });
    const frames = {
      type: "query" as const,
      selector: { type: "css" as const, value: ".chain-frame" },
    };
    try {
      for (const type of ["query", "frame"] as const) {
        await expect(
          client.send(StagehandMethods.locatorCount, {
            pageId: page.pageId,
            selector: { steps: [frames, { type, selector: { type: "text", value: "Pay frame" } }] },
          }),
        ).resolves.toBe(2);
      }
      await expect(
        client.send(StagehandMethods.locatorTextContent, {
          pageId: page.pageId,
          selector: {
            steps: [
              { ...frames, nth: 1 },
              { type: "frame", selector: { type: "css", value: "iframe" } },
              { type: "frame", selector: { type: "text", value: "Nested pay" } },
            ],
          },
        }),
      ).resolves.toBe("Nested pay");
      const sdkPage = new Page(client, page);
      const screenshot = await sdkPage.screenshot({
        mask: [sdkPage.locator(".chain-frame").locator(".mask-target")],
        maskColor: "#ff00ff",
      });
      const pixels = await client.send(StagehandMethods.pageEvaluate, {
        pageId: page.pageId,
        expression: `(async () => {
          const img = new Image();
          img.src = "data:image/png;base64," + ${JSON.stringify(Buffer.from(screenshot).toString("base64"))};
          await img.decode();
          const canvas = document.createElement("canvas");
          canvas.width = img.width; canvas.height = img.height;
          const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0);
          return [...document.querySelectorAll(".chain-frame")].map(frame => {
            const rect = frame.getBoundingClientRect();
            const x = (rect.left + frame.clientLeft + 70) * img.width / innerWidth;
            const y = (rect.top + frame.clientTop + 40) * img.height / innerHeight;
            return [...ctx.getImageData(x, y, 1, 1).data];
          });
        })()`,
      });
      expect(pixels.value).toEqual([
        [255, 0, 255, 255],
        [255, 0, 255, 255],
      ]);
    } finally {
      await client.send(StagehandMethods.pageClose, { pageId: page.pageId });
    }
  }, 30_000);

  it("uses chain scopes and exclusions in the snapshot sent to inference", async () => {
    const client = requireRpcClient(rpcClient);
    const page = await client.send(StagehandMethods.contextNewPage, {
      url: requireFixtureServer(fixtureServer).url + "chains",
    });
    const prompts: string[] = [];
    const stop = client.onRequest(StagehandMethods.llmGenerate, async (input) => {
      prompts.push(JSON.stringify(input.messages));
      return {
        role: "assistant" as const,
        content: { type: "text" as const, text: '{"elements":[]}' },
        outputFormat: "json_schema" as const,
        structuredContent: { elements: [] },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    });
    const sdkPage = new Page(client, page);
    const card = sdkPage.locator(".card").nth(1);
    try {
      await client.send(StagehandMethods.stagehandObserve, {
        pageId: page.pageId,
        instruction: "List available actions",
        options: serializeClientLocatorOptions("observe", page.pageId, {
          locator: card,
          ignoreLocators: [card.locator({ type: "text", value: "Pay second" })],
        }),
      });
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain("Keep second");
      expect(prompts[0]).not.toContain("Pay second");
      expect(prompts[0]).not.toContain("Pay first");
      expect(prompts[0]).not.toContain("Pay outside");
      prompts.length = 0;
      await client.send(StagehandMethods.stagehandObserve, {
        pageId: page.pageId,
        instruction: "List available actions",
        options: serializeClientLocatorOptions("observe", page.pageId, {
          locator: sdkPage.locator(".chain-frame").nth(1).locator(".mask-target"),
        }),
      });
      expect(prompts[0]).toContain("Pay frame");
      expect(prompts[0]).not.toContain("Pay outside");
    } finally {
      stop();
      await client.send(StagehandMethods.pageClose, { pageId: page.pageId });
    }
  }, 30_000);

  it("supports SDK chaining and normalizes existing selector strings at the boundary", async () => {
    const client = requireRpcClient(rpcClient);
    const ref = await client.send(StagehandMethods.contextNewPage, {
      url: requireFixtureServer(fixtureServer).url + "chains",
    });
    const page = new Page(client, ref);
    try {
      const cards = page.locator(".card").nth(1);
      const pay = cards.locator({ type: "text", value: "Pay" });
      expect(await pay.count()).toBe(1);
      expect(await pay.textContent()).toBe("Pay second");
      expect(await page.locator(".card").locator("button").nth(1).textContent()).toBe("Pay second");
      // Legacy >> requires an iframe; ordinary chaining scopes within elements.
      await expect(page.locator("css=.card >> button").count()).rejects.toThrow(
        /frame step requires/i,
      );
      for (const selector of [
        '.chain-frame >> text="Pay frame"',
        "xpath=/html/body/iframe[2]/html/body/button",
        "//iframe[2]//button",
      ]) {
        expect(await page.locator(selector).textContent()).toBe("Pay frame");
      }
      expect(
        await page.locator(".chain-frame").locator({ type: "text", value: "Pay frame" }).count(),
      ).toBe(2);
      expect(
        await page.locator("//iframe[2]").locator("iframe >> text=Nested pay").textContent(),
      ).toBe("Nested pay");
      expect(
        await page
          .locator("#chain-shadow")
          .locator({ type: "xpath", value: ".//button" })
          .textContent(),
      ).toBe("Shadow pay");
      await pay.click();
      expect(await cards.locator("button").textContent()).toBe("Paid second");
      expect(await page.locator("text=Pay first").textContent()).toBe("Pay first");
    } finally {
      await page.close();
    }
  }, 30_000);

  it("returns a newly created URL page with locators ready", async () => {
    const activeRpcClient = requireRpcClient(rpcClient);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const page = await activeRpcClient.send(StagehandMethods.contextNewPage, {
      url: activeFixtureServer.url,
    });

    try {
      expect(page.url).toBe(activeFixtureServer.url);
      await expect(
        activeRpcClient.send(StagehandMethods.locatorTextContent, {
          pageId: page.pageId,
          selector: { type: "legacy" as const, value: "#locator-message" },
        }),
      ).resolves.toBe("locator text");
    } finally {
      await activeRpcClient.send(StagehandMethods.pageClose, { pageId: page.pageId });
    }
  });

  it("supports locators through the CDP fallback world on a data URL", async () => {
    const activeRpcClient = requireRpcClient(rpcClient);
    const page = await activeRpcClient.send(StagehandMethods.contextNewPage, {});
    const html = `<button id="data-button" onclick="this.textContent='Clicked'">Continue</button>`;

    try {
      await activeRpcClient.send(StagehandMethods.pageGoto, {
        pageId: page.pageId,
        url: `data:text/html,${encodeURIComponent(html)}`,
      });
      await expect(
        activeRpcClient.send(StagehandMethods.locatorClick, {
          pageId: page.pageId,
          selector: { type: "legacy" as const, value: "#data-button" },
        }),
      ).resolves.toStrictEqual({ clicked: true });
      await expect(
        activeRpcClient.send(StagehandMethods.locatorTextContent, {
          pageId: page.pageId,
          selector: { type: "legacy" as const, value: "#data-button" },
        }),
      ).resolves.toBe("Clicked");

      await activeRpcClient.send(StagehandMethods.pageEvaluate, {
        pageId: page.pageId,
        expression: `(() => {
          const host = document.createElement("div");
          const root = host.attachShadow({ mode: "open" });
          root.innerHTML = '<span id="data-shadow-text">Open shadow</span>';
          document.body.appendChild(host);
        })()`,
      });
      await expect(
        activeRpcClient.send(StagehandMethods.locatorTextContent, {
          pageId: page.pageId,
          selector: { type: "legacy" as const, value: "#data-shadow-text" },
        }),
      ).resolves.toBe("Open shadow");
      await expect(
        activeRpcClient.send(StagehandMethods.pageEvaluate, {
          pageId: page.pageId,
          expression: `({
            hasLocatorWorldGlobal: "__stagehandLocatorWorld" in window,
            hasLocatorScriptsGlobal: "__stagehandLocatorScripts" in window
          })`,
        }),
      ).resolves.toStrictEqual({
        value: {
          hasLocatorWorldGlobal: false,
          hasLocatorScriptsGlobal: false,
        },
      });

      const activeFixtureServer = requireFixtureServer(fixtureServer);
      await activeRpcClient.send(StagehandMethods.pageGoto, {
        pageId: page.pageId,
        url: activeFixtureServer.url,
      });
      await expect(
        activeRpcClient.send(StagehandMethods.locatorTextContent, {
          pageId: page.pageId,
          selector: { type: "legacy" as const, value: "#locator-message" },
        }),
      ).resolves.toBe("locator text");
    } finally {
      await activeRpcClient.send(StagehandMethods.pageClose, { pageId: page.pageId });
    }
  });

  it("rejects invalid params before the handler runs", async () => {
    await expect(
      rpcClient?.send(StagehandMethods.stagehandMetrics, { extra: true } as never),
    ).rejects.toThrow();
  });

  it("routes page methods through real PageRefs in a browser session", async () => {
    const activeRpcClient = requireRpcClient(rpcClient);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const pages = await activeRpcClient.send(StagehandMethods.contextPages, {});
    const page = pages[0] ?? (await activeRpcClient.send(StagehandMethods.contextNewPage, {}));

    const navigation = await activeRpcClient.send(StagehandMethods.pageGoto, {
      pageId: page.pageId,
      url: activeFixtureServer.url,
    });
    expect(navigation.page).toStrictEqual({
      pageId: page.pageId,
      url: activeFixtureServer.url,
    });
    expect(navigation.response).toMatchObject({
      url: activeFixtureServer.url,
      status: 200,
      statusText: "OK",
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
      fromServiceWorker: false,
    });
    expect(navigation.response?.responseId).toEqual(expect.any(String));

    await expect(
      activeRpcClient.send(StagehandMethods.pageUrl, { pageId: page.pageId }),
    ).resolves.toBe(activeFixtureServer.url);
    await expect(
      activeRpcClient.send(StagehandMethods.pageTitle, { pageId: page.pageId }),
    ).resolves.toBe("Stagehand Smoke");
  });

  it("closes a throwaway PageRef in a browser session", async () => {
    const activeRpcClient = requireRpcClient(rpcClient);
    const page = await activeRpcClient.send(StagehandMethods.contextNewPage, {
      url: "about:blank",
    });

    await expect(
      activeRpcClient.send(StagehandMethods.pageClose, { pageId: page.pageId }),
    ).resolves.toStrictEqual({
      closed: true,
    });
  });

  it("routes locator actions through real PageRefs in a browser session", async () => {
    const activeRpcClient = requireRpcClient(rpcClient);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const pages = await activeRpcClient.send(StagehandMethods.contextPages, {});
    const page = pages[0] ?? (await activeRpcClient.send(StagehandMethods.contextNewPage, {}));

    await activeRpcClient.send(StagehandMethods.pageGoto, {
      pageId: page.pageId,
      url: activeFixtureServer.url,
    });

    await expect(
      activeRpcClient.send(StagehandMethods.locatorIsVisible, {
        pageId: page.pageId,
        selector: { type: "legacy" as const, value: "#locator-message" },
      }),
    ).resolves.toBe(true);

    await expect(
      activeRpcClient.send(StagehandMethods.locatorTextContent, {
        pageId: page.pageId,
        selector: { type: "legacy" as const, value: "#locator-message" },
      }),
    ).resolves.toBe("locator text");

    await expect(
      activeRpcClient.send(StagehandMethods.locatorFill, {
        pageId: page.pageId,
        selector: { type: "legacy" as const, value: "#locator-input" },
        value: "user@example.com",
      }),
    ).resolves.toStrictEqual({
      filled: true,
    });

    await expect(
      activeRpcClient.send(StagehandMethods.locatorClick, {
        pageId: page.pageId,
        selector: { type: "legacy" as const, value: "#locator-button" },
      }),
    ).resolves.toStrictEqual({
      clicked: true,
    });

    await expect(
      activeRpcClient.send(StagehandMethods.locatorTextContent, {
        pageId: page.pageId,
        selector: { type: "legacy" as const, value: "#locator-output" },
      }),
    ).resolves.toBe("clicked:user@example.com");

    await expect(
      activeRpcClient.send(StagehandMethods.locatorFill, {
        pageId: page.pageId,
        selector: { type: "legacy" as const, value: "#locator-date" },
        value: "2026-07-21",
      }),
    ).resolves.toStrictEqual({ filled: true });
    await expect(
      activeRpcClient.send(StagehandMethods.locatorInputValue, {
        pageId: page.pageId,
        selector: { type: "legacy" as const, value: "#locator-date" },
      }),
    ).resolves.toBe("2026-07-21");

    await expect(
      activeRpcClient.send(StagehandMethods.locatorIsVisible, {
        pageId: page.pageId,
        selector: { type: "legacy" as const, value: "#closed-message" },
      }),
    ).resolves.toBe(true);
    await expect(
      activeRpcClient.send(StagehandMethods.locatorTextContent, {
        pageId: page.pageId,
        selector: { type: "legacy" as const, value: "xpath=//div[@id='closed-host']//p[1]" },
      }),
    ).resolves.toBe("closed root text");
    await expect(
      activeRpcClient.send(StagehandMethods.locatorTextContent, {
        pageId: page.pageId,
        selector: { type: "legacy" as const, value: "#shadow-frame >> #frame-closed-message" },
      }),
    ).resolves.toBe("closed root iframe text");

    await activeRpcClient.send(StagehandMethods.locatorFill, {
      pageId: page.pageId,
      selector: { type: "legacy" as const, value: "#closed-input" },
      value: "inside closed root",
    });
    await activeRpcClient.send(StagehandMethods.locatorClick, {
      pageId: page.pageId,
      selector: { type: "legacy" as const, value: "#closed-button" },
    });
    await expect(
      activeRpcClient.send(StagehandMethods.locatorTextContent, {
        pageId: page.pageId,
        selector: { type: "legacy" as const, value: "#closed-output" },
      }),
    ).resolves.toBe("clicked:inside closed root");

    await expect(
      activeRpcClient.send(StagehandMethods.locatorCount, {
        pageId: page.pageId,
        selector: { type: "legacy" as const, value: ".mixed-shadow" },
      }),
    ).resolves.toBe(3);
    await expect(
      activeRpcClient.send(StagehandMethods.locatorTextContent, {
        pageId: page.pageId,
        selector: { type: "legacy" as const, value: ".mixed-shadow" },
        nth: 1,
      }),
    ).resolves.toBe("closed");

    await activeRpcClient.send(StagehandMethods.pageHover, {
      pageId: page.pageId,
      x: 1,
      y: 1,
    });

    await expect(
      activeRpcClient.send(StagehandMethods.pageEvaluate, {
        pageId: page.pageId,
        expression: `({
          hasBackdoor: "__stagehandV3__" in window,
          hasA11yGlobal: "__stagehandA11yScripts" in window,
          hasExtensionWorldGlobal: "__stagehandExtensionWorld" in window,
          hasLocatorWorldGlobal: "__stagehandLocatorWorld" in window,
          hasLocatorScriptsGlobal: "__stagehandLocatorScripts" in window,
          attachShadowIsNative: Element.prototype.attachShadow.toString().includes("[native code]")
        })`,
      }),
    ).resolves.toStrictEqual({
      value: {
        hasBackdoor: false,
        hasA11yGlobal: false,
        hasExtensionWorldGlobal: false,
        hasLocatorWorldGlobal: false,
        hasLocatorScriptsGlobal: false,
        attachShadowIsNative: true,
      },
    });

    await activeRpcClient.send(StagehandMethods.pageEvaluate, {
      pageId: page.pageId,
      expression: `(() => {
        const host = document.createElement("div");
        host.id = "delayed-shadow-host";
        document.body.append(host);
        setTimeout(() => {
          const root = host.attachShadow({ mode: "closed" });
          setTimeout(() => {
            const target = document.createElement("button");
            target.id = "delayed-shadow-target";
            target.textContent = "ready";
            root.append(target);
          }, 100);
        }, 100);
        return true;
      })()`,
    });
    await expect(
      activeRpcClient.send(StagehandMethods.pageWaitForSelector, {
        pageId: page.pageId,
        selector: "#delayed-shadow-target",
        options: { state: "visible", timeout: 2_000, pierceShadow: true },
      }),
    ).resolves.toStrictEqual({ matched: true });
  }, 10_000);

  it("unknown protocol command preserves the protocol error as the cause", async () => {
    await expect(
      rpcClient?.send({ name: "browser.raw_cdp", params: z.object({}), result: z.unknown() }, {}),
    ).rejects.toMatchObject({
      constructor: Error,
      message: "Method not found",
      cause: {
        code: -32601,
        data: { type: "stagehand.unknown_command" },
      },
    });
  });

  it("rpcClient does not expose a raw CDP command method", () => {
    expect(rpcClient).toBeDefined();
    expect("sendCDP" in (rpcClient as object)).toBe(false);
  });
});

async function createFullGraphSmokeExtension(): Promise<string> {
  const extensionDir = await mkdtemp(path.join(tmpdir(), "stagehand-full-graph-extension-"));
  const outputFiles = await readdir(stagehandExtensionDistDir);
  await Promise.all(
    outputFiles.map((file) =>
      cp(path.join(stagehandExtensionDistDir, file), path.join(extensionDir, file), {
        recursive: true,
      }),
    ),
  );

  const extensionEntryPath = fileURLToPath(
    new URL("../../../extension/service-worker.ts", import.meta.url),
  );
  const extensionModulePath = (relativePath: string): string =>
    fileURLToPath(new URL(`../../../extension/${relativePath}`, import.meta.url));
  const workerEntryPath = path.join(extensionDir, "stagehand-full-graph-entry.ts");

  await writeFile(
    workerEntryPath,
    [
      `import ${JSON.stringify(extensionEntryPath)};`,
      `import * as actService from ${JSON.stringify(extensionModulePath("services/actService.ts"))};`,
      `import * as extractService from ${JSON.stringify(extensionModulePath("services/extractService.ts"))};`,
      `import * as observeService from ${JSON.stringify(extensionModulePath("services/observeService.ts"))};`,
      `import * as llmService from ${JSON.stringify(extensionModulePath("services/llmService.ts"))};`,
      `import { StagehandLogger } from ${JSON.stringify(extensionModulePath("logger.ts"))};`,
      `import { withTimeout } from ${JSON.stringify(extensionModulePath("timeoutConfig.ts"))};`,
      `import { CdpConnection } from ${JSON.stringify(extensionModulePath("understudy/cdp.ts"))};`,
      `import { BrowserContext } from ${JSON.stringify(extensionModulePath("understudy/context.ts"))};`,
      `import { Locator } from ${JSON.stringify(extensionModulePath("understudy/locator.ts"))};`,
      `import { Page } from ${JSON.stringify(extensionModulePath("understudy/page.ts"))};`,
      `import { Response } from ${JSON.stringify(extensionModulePath("understudy/response.ts"))};`,
      "const graph = [actService.act, extractService.extract, observeService.observe, llmService.generate, StagehandLogger, withTimeout, CdpConnection, BrowserContext, Locator, Page, Response];",
      "(globalThis as typeof globalThis & { __stagehandExtensionGraph?: string[] }).__stagehandExtensionGraph = graph.map((value) => value.name);",
    ].join("\n"),
  );

  await build({
    configFile: false,
    logLevel: "silent",
    build: {
      emptyOutDir: false,
      minify: false,
      outDir: extensionDir,
      target: "es2022",
      rolldownOptions: {
        input: workerEntryPath,
        output: { entryFileNames: "service-worker.js" },
      },
    },
  });
  await rm(workerEntryPath, { force: true });
  await assertWorkerBundleIsV8Only(extensionDir);
  return extensionDir;
}

async function assertWorkerBundleIsV8Only(extensionDir: string): Promise<void> {
  const outputFiles = await readdir(extensionDir, { recursive: true });
  const forbidden = [
    "__vite-browser-external",
    'from "node:',
    "from 'node:",
    "Node WebSocket transport is unavailable",
    "ws does not work in the browser",
  ];

  for (const relativePath of outputFiles.filter((file) => file.endsWith(".js"))) {
    const source = await readFile(path.join(extensionDir, relativePath), "utf8");
    for (const token of forbidden) {
      if (source.includes(token)) {
        throw new Error(`Worker bundle ${relativePath} contains forbidden Node token ${token}`);
      }
    }
  }
}

function requireRpcClient(value: RPCClient | undefined): RPCClient {
  if (!value) {
    throw new Error("Stagehand RPC client was not initialized");
  }

  return value;
}

function requireFixtureServer(value: FixtureServer | undefined): FixtureServer {
  if (!value) {
    throw new Error("Fixture server was not initialized");
  }

  return value;
}

async function startFixtureServer(): Promise<FixtureServer> {
  const server = createServer((request, response) => {
    if (request.url === "/chain-leaf") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<button>Nested pay</button>");
      return;
    }
    if (request.url === "/chain-frame") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        '<button class="mask-target" style="position:absolute;left:20px;top:20px;width:100px;height:40px">Pay frame</button><iframe src="/chain-leaf" style="position:absolute;top:80px;width:120px;height:40px"></iframe>',
      );
      return;
    }
    if (request.url === "/chains") {
      response.writeHead(200, { "content-type": "text/html" });
      const crossOrigin = `http://localhost:${request.headers.host!.split(":").at(-1)}/chain-frame`;
      response.end(`<!doctype html><html><body>
        <button>Pay outside</button>
        <section class="card" aria-label="First card"><button>Pay first</button></section>
        <section class="card" aria-label="Second card"><div class="nested">
          <button onclick="this.textContent='Paid second'">Pay second</button><p>Keep second</p>
        </div></section>
        <div id="chain-shadow"></div>
        <iframe class="chain-frame" src="/chain-frame" style="width:180px;height:150px"></iframe>
        <iframe class="chain-frame" src="${crossOrigin}" style="width:180px;height:150px"></iframe>
        <script>document.querySelector("#chain-shadow").attachShadow({mode:"closed"}).innerHTML = "<button>Shadow pay</button>"</script>
      </body></html>`);
      return;
    }

    if (request.url === "/frame") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html>
  <body>
    <div id="frame-closed-host"></div>
    <script>
      const root = document
        .querySelector("#frame-closed-host")
        .attachShadow({ mode: "closed" });
      root.innerHTML = '<p id="frame-closed-message">closed root iframe text</p>';
    </script>
  </body>
</html>`);
      return;
    }

    if (request.url !== "/") {
      response.writeHead(404);
      response.end("not found");
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html>
  <head>
    <title>Stagehand Smoke</title>
  </head>
  <body>
    <button id="smoke-button" onclick="document.title = 'Stagehand Smoke Clicked'; this.textContent = 'Clicked';">Click me</button>
    <p id="locator-message">locator text</p>
    <label for="locator-input">Email</label>
    <input id="locator-input" name="email" />
    <label for="locator-date">Date</label>
    <input id="locator-date" type="date" />
    <button
      id="locator-button"
      onclick="document.querySelector('#locator-output').textContent = 'clicked:' + document.querySelector('#locator-input').value;"
    >
      Submit
    </button>
    <p id="locator-output">waiting</p>
    <p class="mixed-shadow">light</p>
    <div id="closed-host"><p>light DOM collision</p></div>
    <div id="open-host"></div>
    <iframe id="shadow-frame" src="/frame"></iframe>
    <script>
      const closedRoot = document.querySelector("#closed-host").attachShadow({ mode: "closed" });
      closedRoot.innerHTML = [
        '<p id="closed-message">closed root text</p>',
        '<input id="closed-input" />',
        '<button id="closed-button">Submit closed</button>',
        '<p id="closed-output">waiting</p>',
        '<p class="mixed-shadow">closed</p>',
      ].join("");
      closedRoot.querySelector("#closed-button").addEventListener("click", () => {
        closedRoot.querySelector("#closed-output").textContent =
          "clicked:" + closedRoot.querySelector("#closed-input").value;
      });

      const openRoot = document.querySelector("#open-host").attachShadow({ mode: "open" });
      openRoot.innerHTML = '<p class="mixed-shadow">open</p>';
    </script>
  </body>
</html>`);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Fixture server did not bind to a TCP port");
  }

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
