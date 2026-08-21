import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const sdkRoot = new URL("..", import.meta.url);

describe("published TypeScript SDK", () => {
  it("installs the tarball and resolves both packaged extension artifacts", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), "stagehand package contract with spaces "),
    );
    const tarballPath = path.join(temporaryRoot, "stagehand-sdk.tgz");
    const consumerDirectory = path.join(temporaryRoot, "consumer with spaces");

    try {
      await execFileAsync("pnpm", ["pack", "--out", tarballPath], {
        cwd: sdkRoot,
      });
      await mkdir(consumerDirectory);
      await writeFile(
        path.join(consumerDirectory, "package.json"),
        `${JSON.stringify(
          {
            private: true,
            type: "module",
            packageManager: "pnpm@11.10.0",
            dependencies: {
              "@browserbasehq/stagehand": "file:../stagehand-sdk.tgz",
            },
            devDependencies: {
              typescript: "5.9.3",
            },
          },
          null,
          2,
        )}\n`,
      );
      await execFileAsync("pnpm", ["install", "--prefer-offline", "--ignore-scripts"], {
        cwd: consumerDirectory,
      });
      await writeFile(
        path.join(consumerDirectory, "verify.mjs"),
        `
            import { access, readFile } from "node:fs/promises";
            import { fileURLToPath } from "node:url";
            import {
              browserbase,
              BrowserbaseConnectOptionsSchema,
              localBrowser,
              LocalBrowserConnectOptionsSchema,
              Response,
              Stagehand,
              WebMCPInvocation,
              WebMCPTool,
              WebMCPToolsOptionsSchema,
            } from "@browserbasehq/stagehand";

            if (typeof Stagehand !== "function") throw new Error("Stagehand export is unavailable");
            if (typeof Response !== "function") throw new Error("Response export is unavailable");
            if ("init" in Stagehand.prototype) {
              throw new Error("legacy Stagehand.init is still published");
            }
            if ("context" in Stagehand.prototype) {
              throw new Error("legacy Stagehand.context is still published");
            }
            if (typeof localBrowser?.launch !== "function") {
              throw new Error("localBrowser export is unavailable");
            }
            if (typeof browserbase?.connect !== "function") {
              throw new Error("browserbase export is unavailable");
            }
            LocalBrowserConnectOptionsSchema.parse({ cdpUrl: "ws://127.0.0.1:9222" });
            BrowserbaseConnectOptionsSchema.parse({ apiKey: "bb_key", sessionId: "session_123" });
            if (typeof WebMCPTool !== "function") throw new Error("WebMCPTool export is unavailable");
            if (typeof WebMCPInvocation !== "function") {
              throw new Error("WebMCPInvocation export is unavailable");
            }
            WebMCPToolsOptionsSchema.parse({ timeout: 1000 });
            const entryUrl = import.meta.resolve("@browserbasehq/stagehand");
            const archiveUrl = new URL("./assets/stagehand-extension.zip", entryUrl);
            const manifestUrl = new URL("./extension/manifest.json", entryUrl);
            await access(fileURLToPath(archiveUrl));
            await access(fileURLToPath(manifestUrl));
            const manifest = JSON.parse(await readFile(fileURLToPath(manifestUrl), "utf8"));
            if (manifest.manifest_version !== 3) throw new Error("Invalid packaged manifest");
          `,
      );
      await writeFile(
        path.join(consumerDirectory, "verify.ts"),
        `
          import type {
            Caching,
            LoadState,
            LocatorCentroidResult,
            LocatorClickOptions,
            LocatorHighlightOptions,
            LocatorSendClickEventOptions,
            LocatorTypeOptions,
            ModelConfig,
            ModelName,
            MouseButton,
            PageClickOptions,
            PageDragAndDropOptions,
            PageDragAndDropRoutePoint,
            PageKeyPressOptions,
            PageNavigationOptions,
            PageReloadOptions,
            PageScreenshotClip,
            PageSetViewportSizeOptions,
            PageSnapshotOptions,
            PageTypeOptions,
            PageWaitForSelectorOptions,
            RgbaColor,
            SnapshotResult,
            StagehandClientActOptions,
            StagehandClientExtractOptions,
            StagehandClientObserveOptions,
            StagehandResultUsage,
            Variables,
          } from "@browserbasehq/stagehand";

          const loadState: LoadState = "domcontentloaded";
          const mouseButton: MouseButton = "left";
          const modelName: ModelName = "openai/gpt-5";
          const model: ModelConfig = { modelName };
          const caching: Caching = { threshold: 2 };
          const variables: Variables = {
            username: { value: "sean", description: "The login username" },
          };
          const routePoint: PageDragAndDropRoutePoint = { x: 10, y: 20 };
          const clip: PageScreenshotClip = { x: 0, y: 0, width: 100, height: 100 };
          const color: RgbaColor = { r: 255, g: 0, b: 0, a: 0.5 };
          const navigation: PageNavigationOptions = { waitUntil: loadState, timeout: 1_000 };
          const pageClick: PageClickOptions = { button: mouseButton, clickCount: 1 };
          const pageDrag: PageDragAndDropOptions = { route: [routePoint] };
          const pageKeyPress: PageKeyPressOptions = { delay: 0 };
          const pageReload: PageReloadOptions = navigation;
          const pageViewport: PageSetViewportSizeOptions = { deviceScaleFactor: 2 };
          const pageSnapshot: PageSnapshotOptions = { includeIframes: true };
          const pageType: PageTypeOptions = { delay: 0, withMistakes: false };
          const pageWait: PageWaitForSelectorOptions = { state: "visible", timeout: 1_000 };
          const locatorClick: LocatorClickOptions = pageClick;
          const locatorHighlight: LocatorHighlightOptions = { borderColor: color };
          const locatorSendClick: LocatorSendClickEventOptions = { bubbles: true };
          const locatorType: LocatorTypeOptions = { delay: 0 };
          const actOptions: StagehandClientActOptions = { cache: caching, model, variables };
          const observeOptions: StagehandClientObserveOptions = { model, variables };
          const extractOptions: StagehandClientExtractOptions = { model };

          declare const centroid: LocatorCentroidResult;
          declare const snapshot: SnapshotResult;
          declare const usage: StagehandResultUsage;

          void [
            clip,
            navigation,
            pageClick,
            pageDrag,
            pageKeyPress,
            pageReload,
            pageViewport,
            pageSnapshot,
            pageType,
            pageWait,
            locatorClick,
            locatorHighlight,
            locatorSendClick,
            locatorType,
            actOptions,
            observeOptions,
            extractOptions,
            centroid,
            snapshot,
            usage,
          ];
        `,
      );

      await execFileAsync(process.execPath, [path.join(consumerDirectory, "verify.mjs")], {
        cwd: consumerDirectory,
      });
      await execFileAsync(
        "pnpm",
        [
          "exec",
          "tsc",
          "--noEmit",
          "--module",
          "nodenext",
          "--moduleResolution",
          "nodenext",
          "--target",
          "es2022",
          "verify.ts",
        ],
        { cwd: consumerDirectory },
      );
      expect(
        JSON.parse(await readFile(path.join(consumerDirectory, "package.json"), "utf8")),
      ).toMatchObject({ private: true });
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  }, 120_000);
});
