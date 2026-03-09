import Browserbase from "@browserbasehq/sdk";
import { Stagehand } from "../lib/v3/index.js";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const ARCHIVEWEB_ROOT = "/Users/squash/Local/Code/archiveweb.page";
const OUTPUT_WACZ_PATH = path.resolve(process.cwd(), "recording.wacz");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms: ${label}`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function runCommand(
  command: string,
  args: string[],
  opts: { cwd?: string; stdio?: "pipe" | "inherit" } = {},
): string {
  const result = spawnSync(command, args, {
    cwd: opts.cwd,
    stdio: opts.stdio ?? "pipe",
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? "";
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\n${stderr.trim()}`,
    );
  }

  return result.stdout?.toString() ?? "";
}

async function ensureArchivewebExtensionBuild(
  archivewebRoot: string,
): Promise<string> {
  const distExtPath = path.join(archivewebRoot, "dist", "ext");
  const manifestPath = path.join(distExtPath, "manifest.json");

  try {
    await fs.access(manifestPath);
    return distExtPath;
  } catch {
    console.log("Building archiveweb.page extension (dist/ext not found)...");
    runCommand("yarn", ["build-dev"], { cwd: archivewebRoot, stdio: "inherit" });
    await fs.access(manifestPath);
    return distExtPath;
  }
}

async function zipExtension(distExtPath: string): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "archiveweb-ext-"));
  const zipPath = path.join(tmpDir, "archiveweb.page.zip");
  runCommand("zip", ["-r", "-q", zipPath, "."], { cwd: distExtPath });
  return zipPath;
}

async function waitForRuntimeExtensionId(
  stagehand: Stagehand,
  timeoutMs = 30_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const seenUrls = new Set<string>();

  while (Date.now() < deadline) {
    const response = (await stagehand.context.conn.send("Target.getTargets")) as {
      targetInfos?: Array<{ url?: string }>;
    };

    const urls = response.targetInfos?.map((target) => target.url ?? "") ?? [];
    for (const url of urls) {
      if (url) {
        seenUrls.add(url);
      }
      const match = url.match(/^chrome-extension:\/\/([a-z]{32})\//);
      if (match?.[1]) {
        return match[1];
      }
    }

    await sleep(500);
  }

  throw new Error(
    `Could not resolve runtime Chrome extension ID. Targets seen: ${JSON.stringify(
      [...seenUrls],
    )}`,
  );
}

type CdpEvaluablePage = {
  sendCDP: <T = unknown>(method: string, params?: object) => Promise<T>;
  close: () => Promise<void>;
};

async function evaluateInPage<T>(
  page: CdpEvaluablePage,
  expression: string,
): Promise<T> {
  const response = await withTimeout(
    page.sendCDP<{
      result?: { value?: T };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }),
    180_000,
    "Runtime.evaluate",
  );

  if (response.exceptionDetails) {
    const detail =
      response.exceptionDetails.exception?.description ??
      response.exceptionDetails.text ??
      "Runtime.evaluate failed";
    throw new Error(detail);
  }

  return response.result?.value as T;
}

async function startArchivewebRecording(
  controlPage: CdpEvaluablePage,
): Promise<{ tabId: number; collId: string }> {
  const expression = `
    (async () => {
      const chromeApi = globalThis.chrome;
      if (!chromeApi?.runtime || !chromeApi?.tabs) {
        throw new Error("chrome.runtime/tabs is unavailable in popup context");
      }

      const waitForMessage = (port, predicate, timeoutMs, label) =>
        new Promise((resolve, reject) => {
          const onMessage = (message) => {
            if (!predicate(message)) {
              return;
            }
            clearTimeout(timer);
            port.onMessage.removeListener(onMessage);
            resolve(message);
          };

          const timer = setTimeout(() => {
            port.onMessage.removeListener(onMessage);
            reject(new Error(\`Timed out waiting for \${label}\`));
          }, timeoutMs);

          port.onMessage.addListener(onMessage);
        });

      const isRecordableTab = (tab) =>
        typeof tab?.id === "number" &&
        typeof tab?.url === "string" &&
        !tab.url.startsWith("chrome-extension://") &&
        !tab.url.startsWith("chrome://") &&
        !tab.url.startsWith("devtools://");

      const activeTabs = await chromeApi.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      const tabs = await chromeApi.tabs.query({});
      const targetTab =
        activeTabs.find((tab) => isRecordableTab(tab)) ||
        tabs.find((tab) => isRecordableTab(tab));

      if (!targetTab?.id) {
        throw new Error("No target tab found for archive recording");
      }

      const port = chromeApi.runtime.connect({ name: "popup-port" });
      try {
        port.postMessage({ type: "startUpdates", tabId: targetTab.id });
        const collectionsMsg = await waitForMessage(
          port,
          (message) => message?.type === "collections",
          15000,
          "collections list"
        );

        const collId = collectionsMsg?.collId ?? collectionsMsg?.collections?.[0]?.id;
        if (!collId) {
          throw new Error("No collection ID available for archive recording");
        }

        port.postMessage({
          type: "startRecording",
          collId,
          url: targetTab.url,
          autorun: true,
        });

        await waitForMessage(
          port,
          (message) => message?.type === "status" && message?.recording === true,
          30000,
          "recording start confirmation"
        );

        return { tabId: targetTab.id, collId };
      } finally {
        port.disconnect();
      }
    })()
  `;

  return await evaluateInPage<{ tabId: number; collId: string }>(
    controlPage,
    expression,
  );
}

async function stopArchivewebRecording(
  controlPage: CdpEvaluablePage,
  args: { tabId: number; fallbackCollId: string },
): Promise<string> {
  const expression = `
    (async () => {
      const tabId = ${JSON.stringify(args.tabId)};
      const fallbackCollId = ${JSON.stringify(args.fallbackCollId)};
      const chromeApi = globalThis.chrome;
      if (!chromeApi?.runtime) {
        throw new Error("chrome.runtime is unavailable in popup context");
      }

      const waitForMessage = (port, predicate, timeoutMs, label) =>
        new Promise((resolve, reject) => {
          const onMessage = (message) => {
            if (!predicate(message)) {
              return;
            }
            clearTimeout(timer);
            port.onMessage.removeListener(onMessage);
            resolve(message);
          };

          const timer = setTimeout(() => {
            port.onMessage.removeListener(onMessage);
            reject(new Error(\`Timed out waiting for \${label}\`));
          }, timeoutMs);

          port.onMessage.addListener(onMessage);
        });

      const port = chromeApi.runtime.connect({ name: "popup-port" });
      try {
        port.postMessage({ type: "startUpdates", tabId });
        port.postMessage({ type: "stopRecording" });
        try {
          const statusMsg = await waitForMessage(
            port,
            (message) =>
              message?.type === "status" &&
              message?.recording === false &&
              !message?.stopping,
            20000,
            "recording stop confirmation"
          );

          return statusMsg?.collId ?? fallbackCollId;
        } catch {
          return fallbackCollId;
        }
      } finally {
        port.disconnect();
      }
    })()
  `;

  const result = await evaluateInPage<string>(controlPage, expression);
  if (!result) {
    throw new Error("Failed to resolve collection ID after stopping recording");
  }
  return result;
}

async function navigateRecordedTab(
  controlPage: CdpEvaluablePage,
  tabId: number,
  url: string,
): Promise<string> {
  const expression = `
    (async () => {
      const tabId = ${JSON.stringify(tabId)};
      const url = ${JSON.stringify(url)};
      const chromeApi = globalThis.chrome;
      if (!chromeApi?.tabs) {
        throw new Error("chrome.tabs is unavailable in popup context");
      }

      for (let i = 0; i < 8; i++) {
        await chromeApi.tabs.update(tabId, { url, active: true });
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const tab = await chromeApi.tabs.get(tabId);
        const current = tab?.pendingUrl || tab?.url || "";
        if (current.includes("dQw4w9WgXcQ")) {
          return current;
        }
      }

      const tab = await chromeApi.tabs.get(tabId);
      return tab?.pendingUrl || tab?.url || "";
    })()
  `;

  return await evaluateInPage<string>(controlPage, expression);
}

type RecordingStatusSnapshot = {
  tabUrl: string;
  pendingUrl: string;
  numPages: number;
  numUrls: number;
  recording: boolean;
};

async function getRecordingStatus(
  controlPage: CdpEvaluablePage,
  tabId: number,
): Promise<RecordingStatusSnapshot> {
  const expression = `
    (async () => {
      const tabId = ${JSON.stringify(tabId)};
      const chromeApi = globalThis.chrome;
      if (!chromeApi?.runtime || !chromeApi?.tabs) {
        throw new Error("chrome.runtime/tabs is unavailable in popup context");
      }

      const waitForMessage = (port, predicate, timeoutMs) =>
        new Promise((resolve, reject) => {
          const onMessage = (message) => {
            if (!predicate(message)) return;
            clearTimeout(timer);
            port.onMessage.removeListener(onMessage);
            resolve(message);
          };

          const timer = setTimeout(() => {
            port.onMessage.removeListener(onMessage);
            reject(new Error("Timed out waiting for recording status"));
          }, timeoutMs);

          port.onMessage.addListener(onMessage);
        });

      const port = chromeApi.runtime.connect({ name: "popup-port" });
      try {
        port.postMessage({ type: "startUpdates", tabId });
        const status = await waitForMessage(
          port,
          (message) => message?.type === "status",
          7000,
        );
        const tab = await chromeApi.tabs.get(tabId);
        return {
          tabUrl: tab?.url || "",
          pendingUrl: tab?.pendingUrl || "",
          numPages: Number(status?.numPages || 0),
          numUrls: Number(status?.numUrls || 0),
          recording: Boolean(status?.recording),
        };
      } finally {
        port.disconnect();
      }
    })()
  `;

  return await evaluateInPage<RecordingStatusSnapshot>(controlPage, expression);
}

async function triggerWaczDownload(
  controlPage: CdpEvaluablePage,
  extensionId: string,
  collId: string,
): Promise<void> {
  const url = `chrome-extension://${extensionId}/w/api/c/${encodeURIComponent(collId)}/dl?format=wacz&pages=all`;
  await withTimeout(
    controlPage.sendCDP("Page.navigate", { url }),
    20_000,
    "Page.navigate (trigger WACZ download)",
  );
}

async function saveWaczFromExtensionApi(
  controlPage: CdpEvaluablePage,
  extensionId: string,
  collId: string,
  outputPath: string,
): Promise<void> {
  const expression = `
    (async () => {
      const url = "chrome-extension://${extensionId}/w/api/c/" + encodeURIComponent(${JSON.stringify(
        collId,
      )}) + "/dl?format=wacz&pages=all";
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      let lastStatus = 0;

      for (let i = 0; i < 25; i++) {
        const response = await fetch(url);
        lastStatus = response.status;
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = "";
          const chunkSize = 0x8000;
          for (let j = 0; j < bytes.length; j += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(j, j + chunkSize));
          }
          return btoa(binary);
        }

        await sleep(2_000);
      }

      throw new Error("WACZ fetch failed after retries: status " + lastStatus);
    })()
  `;

  const base64 = await evaluateInPage<string>(controlPage, expression);
  if (!base64 || !base64.length) {
    throw new Error("Extension API returned empty WACZ content");
  }
  await fs.writeFile(outputPath, Buffer.from(base64, "base64"));
}

async function saveWaczFromBrowserbaseDownloads(
  bb: Browserbase,
  sessionId: string,
  outputPath: string,
  timeoutMs = 300_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bb-downloads-"));
  const zipPath = path.join(tmpDir, "downloads.zip");

  while (Date.now() < deadline) {
    try {
      const response = await withTimeout(
        bb.sessions.downloads.list(sessionId),
        15_000,
        "sessions.downloads.list",
      );
      if (response.ok) {
        const zipData = Buffer.from(
          await withTimeout(
            response.arrayBuffer(),
            15_000,
            "downloads.arrayBuffer",
          ),
        );
        if (zipData.length > 22) {
          await fs.writeFile(zipPath, zipData);

          const listed = runCommand("unzip", ["-Z1", zipPath])
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

          const waczEntry = listed.reverse().find((entry) => {
            return entry.toLowerCase().endsWith(".wacz");
          });

          if (waczEntry) {
            const extracted = spawnSync("unzip", ["-p", zipPath, waczEntry], {
              encoding: "buffer",
            });
            if (
              extracted.status === 0 &&
              extracted.stdout &&
              Buffer.isBuffer(extracted.stdout) &&
              extracted.stdout.length > 0
            ) {
              await fs.writeFile(outputPath, extracted.stdout);
              return;
            }
          }
        }
      }
    } catch {
      // Downloads may not be ready yet.
    }

    await sleep(2_000);
  }

  throw new Error("Timed out waiting for recording.wacz in Browserbase downloads");
}

async function main(): Promise<void> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;

  if (!apiKey || !projectId) {
    throw new Error(
      "Missing BROWSERBASE_API_KEY or BROWSERBASE_PROJECT_ID (source .env first)",
    );
  }

  const bb = new Browserbase({ apiKey });
  const distExtPath = await ensureArchivewebExtensionBuild(ARCHIVEWEB_ROOT);
  const extensionZipPath = await zipExtension(distExtPath);
  console.log("Uploading extension to Browserbase...");
  const extension = await bb.extensions.create({
    file: createReadStream(extensionZipPath),
  });
  console.log(`Uploaded extension: ${extension.id}`);

  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey,
    projectId,
    model: "openai/gpt-4.1",
    verbose: 1,
    disableAPI: true,
    browserbaseSessionCreateParams: {
      extensionId: extension.id,
      browserSettings: {
        recordSession: true,
      },
    },
  });

  let sessionId: string | null = null;
  let controlPage: CdpEvaluablePage | null = null;
  let pwBrowser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;

  try {
    console.log("Initializing Stagehand session...");
    await stagehand.init();
    sessionId = stagehand.browserbaseSessionID;
    if (!sessionId) {
      throw new Error("Browserbase session ID was not set after init");
    }
    console.log(`Session ID: ${sessionId}`);
    console.log("Resolving runtime extension ID...");
    const runtimeExtensionId = await waitForRuntimeExtensionId(stagehand);
    console.log(`Runtime extension ID: ${runtimeExtensionId}`);

    controlPage = await stagehand.context.newPage(
      `chrome-extension://${runtimeExtensionId}/popup.html`,
    );
    console.log("Starting archiveweb.page recording...");

    const { tabId, collId } = await startArchivewebRecording(controlPage);
    console.log(`Recording started on tab ${tabId} (collId=${collId})`);

    console.log("Connecting Playwright over CDP...");
    pwBrowser = await chromium.connectOverCDP({
      wsEndpoint: stagehand.connectURL(),
    });
    const pwContext = pwBrowser.contexts()[0];
    if (!pwContext) {
      throw new Error("No Playwright context found on CDP session");
    }

    let pwPage =
      pwContext
        .pages()
        .find(
          (page) =>
            !page.url().startsWith("chrome-extension://") &&
            !page.url().startsWith("devtools://"),
        ) ?? null;
    if (!pwPage) {
      pwPage = await pwContext.newPage();
    }
    console.log(`Playwright page URL before navigate: ${pwPage.url()}`);

    type StagehandWithNavigate = Stagehand & {
      navigate: (url: string) => Promise<void>;
    };
    const stagehandWithNavigate = stagehand as StagehandWithNavigate;
    stagehandWithNavigate.navigate = async (url: string) => {
      try {
        await pwPage.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const recoverable =
          message.includes("ERR_ABORTED") ||
          message.includes("Page crashed") ||
          message.includes("Target crashed") ||
          message.includes("Target closed") ||
          message.includes("frame was detached");
        if (!recoverable) {
          throw error;
        }
        console.log(`Navigate warning: ${message}`);
      }
    };

    await stagehandWithNavigate.navigate(
      "https://www.youtube.com/?hl=en&gl=US&persist_hl=1&persist_gl=1",
    );
    console.log(`Primary page URL: ${pwPage.url()}`);
    console.log(`Primary page title: ${await pwPage.title()}`);
    console.log('Running stagehand.act: type "rickroll"...');
    await pwPage.bringToFront();
    await withTimeout(
      stagehand.act('Type "rickroll" into the search box', {
        page: pwPage,
        timeout: 45_000,
      }),
      120_000,
      'stagehand.act("Type rickroll...")',
    );
    console.log("Pressing Enter, waiting 10s, then navigating directly to video...");
    await pwPage.bringToFront();
    await withTimeout(
      stagehand.act("Press Enter", {
        page: pwPage,
        timeout: 30_000,
      }),
      120_000,
      'stagehand.act("Press Enter")',
    );
    await sleep(10_000);
    await stagehandWithNavigate.navigate(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    const recordedTabUrl = await navigateRecordedTab(
      controlPage,
      tabId,
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    console.log(`Recorded tab URL after forced navigate: ${recordedTabUrl}`);
    let settled = false;
    let maxPages = 0;
    for (let i = 0; i < 40; i++) {
      const status = await getRecordingStatus(controlPage, tabId);
      const currentUrl = status.pendingUrl || status.tabUrl;
      maxPages = Math.max(maxPages, status.numPages);
      console.log(
        `Recorder status: recording=${status.recording} numPages=${status.numPages} numUrls=${status.numUrls} tabUrl=${currentUrl}`,
      );
      if (currentUrl.includes("dQw4w9WgXcQ") && status.numPages >= 3) {
        settled = true;
        break;
      }
      await sleep(2_000);
    }
    if (!settled) {
      console.log(
        `Warning: recorder did not reach expected watch-page settle state (max numPages=${maxPages})`,
      );
    }

    await controlPage.sendCDP("Page.bringToFront");
    console.log("Stopping archiveweb.page recording...");
    const resolvedCollId = await stopArchivewebRecording(controlPage, {
      tabId,
      fallbackCollId: collId,
    });
    console.log(`Recording stopped (collId=${resolvedCollId})`);
    await sleep(8_000);

    console.log("Fetching WACZ from extension API...");
    try {
      await saveWaczFromExtensionApi(
        controlPage,
        runtimeExtensionId,
        resolvedCollId,
        OUTPUT_WACZ_PATH,
      );
    } catch (error) {
      if (error instanceof Error) {
        console.log(`Extension API error: ${error.message}`);
      }
      console.log(
        "Extension API WACZ fetch failed, falling back to Browserbase downloads...",
      );
      await triggerWaczDownload(controlPage, runtimeExtensionId, resolvedCollId);
      await saveWaczFromBrowserbaseDownloads(bb, sessionId, OUTPUT_WACZ_PATH);
    }

    console.log(`Saved WACZ: ${OUTPUT_WACZ_PATH}`);
  } finally {
    if (pwBrowser) {
      try {
        await withTimeout(pwBrowser.close(), 15_000, "pwBrowser.close");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Warning: ${message}`);
      }
    }

    if (controlPage) {
      try {
        await withTimeout(controlPage.close(), 15_000, "controlPage.close");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Warning: ${message}`);
      }
    }

    try {
      await withTimeout(
        stagehand.close({ force: true }),
        30_000,
        "stagehand.close",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Warning: ${message}`);
    }

    if (sessionId) {
      try {
        await withTimeout(
          bb.sessions.update(sessionId, {
            projectId,
            status: "REQUEST_RELEASE",
          }),
          15_000,
          "bb.sessions.update(REQUEST_RELEASE)",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Warning: ${message}`);
      }
    }

    try {
      await withTimeout(
        bb.extensions.delete(extension.id),
        15_000,
        "bb.extensions.delete",
      );
    } catch {
      // Best effort cleanup for uploaded extension.
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
