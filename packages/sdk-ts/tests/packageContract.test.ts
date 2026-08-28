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
      const installedPackage = path.join(
        consumerDirectory,
        "node_modules",
        "@browserbasehq",
        "stagehand",
      );
      const publishedManifest = JSON.parse(
        await readFile(path.join(installedPackage, "package.json"), "utf8"),
      ) as { dependencies?: Record<string, string> };
      const runtimeBundle = await readFile(path.join(installedPackage, "dist/index.mjs"), "utf8");
      const declarations = await readFile(path.join(installedPackage, "dist/index.d.mts"), "utf8");
      const extensionBundle = await readFile(
        path.join(installedPackage, "dist/extension/service-worker.js"),
        "utf8",
      );
      const zodRuntimeImport = /(?:from\s*|import\s*)["']zod(?:\/[^"']*)?["']|require\(["']zod/u;

      expect(publishedManifest.dependencies?.zod).toBe("^4.2.0");
      expect(publishedManifest.dependencies?.["@standard-schema/spec"]).toBeDefined();
      expect(publishedManifest.dependencies).not.toHaveProperty("@cfworker/json-schema");
      expect(publishedManifest.dependencies).not.toHaveProperty("json-schema-typed");
      expect(publishedManifest.dependencies).not.toHaveProperty("typebox");
      expect(runtimeBundle).toMatch(zodRuntimeImport);
      expect(runtimeBundle).not.toContain("@cfworker/json-schema");
      expect(runtimeBundle).not.toMatch(/typebox|runtime-schema|zod\/compile/u);
      expect(declarations).toMatch(/from\s+["']zod(?:\/[^"']*)?["']/u);
      expect(declarations).toMatch(/from\s+["']@standard-schema\/spec["']/u);
      expect(declarations).not.toMatch(/from\s+["']json-schema-typed["']/u);
      expect(declarations).toContain("JsonSchemaDocument");
      expect(declarations).not.toContain("JsonSchemaProperties");
      expect(declarations).not.toContain("RawJsonSchema");
      expect(declarations).not.toMatch(/from\s+["']typebox(?:\/[^"']*)?["']/u);
      expect(declarations).not.toMatch(/runtime-schema|zod\/compile/u);
      expect(extensionBundle).not.toMatch(/typebox|runtime-schema|fromJSONSchema|zod\/compile/u);
      expect(extensionBundle).toContain("@cfworker/json-schema");
      expect(declarations).toMatch(/declare const LocalBrowserConnectOptionsSchema: z\.ZodObject/u);

      const { stdout: productionList } = await execFileAsync(
        "pnpm",
        ["list", "zod", "--prod", "--depth", "Infinity", "--json"],
        { cwd: consumerDirectory },
      );
      const listed = JSON.parse(productionList) as Array<{
        dependencies?: Record<string, unknown>;
      }>;
      expect(JSON.stringify(listed)).toContain('"zod"');
      expect(JSON.stringify(listed)).not.toContain('"@cfworker/json-schema"');
      expect(JSON.stringify(listed)).not.toContain('"json-schema-typed"');
      await writeFile(
        path.join(consumerDirectory, "verify.mjs"),
        `
            import { access, readFile } from "node:fs/promises";
            import { fileURLToPath } from "node:url";
            import {
              browserbase,
              BrowserbaseConnectOptionsSchema,
              jsonSchema,
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
            LocalBrowserConnectOptionsSchema.shape.cdpUrl.parse("ws://127.0.0.1:9222");
            LocalBrowserConnectOptionsSchema.extend({ label: LocalBrowserConnectOptionsSchema.shape.cdpUrl });
            LocalBrowserConnectOptionsSchema.pick({ cdpUrl: true }).safeParse({
              cdpUrl: "ws://127.0.0.1:9222",
            });
            BrowserbaseConnectOptionsSchema.parse({ apiKey: "bb_key", sessionId: "session_123" });
            const rawSchema = jsonSchema({
              type: "object",
              properties: { ok: { type: "boolean" } },
              required: ["ok"],
            });
            const rawResult = await rawSchema["~standard"].validate({ ok: true });
            if (!("value" in rawResult)) throw new Error("Raw schema adapter validation failed");
            if (typeof WebMCPTool !== "function") throw new Error("WebMCPTool export is unavailable");
            if (typeof WebMCPInvocation !== "function") {
              throw new Error("WebMCPInvocation export is unavailable");
            }
            WebMCPToolsOptionsSchema.parse({ timeout: 1000 });
            const entryUrl = import.meta.resolve("@browserbasehq/stagehand");
            const archiveUrl = new URL("./assets/stagehand-extension.zip", entryUrl);
            const manifestUrl = new URL("./extension/manifest.json", entryUrl);
            await access(fileURLToPath(archiveUrl));
            const manifest = JSON.parse(await readFile(fileURLToPath(manifestUrl), "utf8"));
            if (manifest.manifest_version !== 3) throw new Error("Invalid packaged manifest");
          `,
      );
      await writeFile(
        path.join(consumerDirectory, "verify.ts"),
        `
          import type {
            Caching,
            ExtractMetadata,
            ExtractResult,
            JsonSchemaDocument,
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
            StagehandSchema,
            Variables,
          } from "@browserbasehq/stagehand";
          import { Stagehand } from "@browserbasehq/stagehand";

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
          declare const extractMetadata: ExtractMetadata;
          declare const stagehand: Stagehand;
          declare const nativeSchema: StagehandSchema<string, number>;
          declare const schemaDocument: JsonSchemaDocument;

          const nativeResult: Promise<ExtractResult<number>> = stagehand.extract("length", nativeSchema);

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
            schemaDocument,
            centroid,
            snapshot,
            usage,
            extractMetadata,
            nativeResult,
          ];
        `,
      );

      await execFileAsync(process.execPath, [path.join(consumerDirectory, "verify.mjs")], {
        cwd: consumerDirectory,
      });
      try {
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
      } catch (error) {
        const output = error as { stderr?: string; stdout?: string };
        throw new Error(
          output.stderr || output.stdout || "Consumer TypeScript compilation failed",
          {
            cause: error,
          },
        );
      }
      await execFileAsync(
        "pnpm",
        [
          "add",
          "--save-dev",
          "--prefer-offline",
          "zod@4.2.0",
          "arktype@2.1.28",
          "valibot@1.2.0",
          "@valibot/to-json-schema@1.5.0",
          "typebox@1.3.7",
        ],
        { cwd: consumerDirectory },
      );
      await writeFile(
        path.join(consumerDirectory, "verify-ecosystems.ts"),
        `
          import { type } from "arktype";
          import { toStandardJsonSchema } from "@valibot/to-json-schema";
          import * as v from "valibot";
          import { z } from "zod/v4";
          import Type, { type Static } from "typebox";
          import {
            jsonSchema,
            LocalBrowserConnectOptionsSchema,
            Stagehand,
            type ExtractResult,
          } from "@browserbasehq/stagehand";

          declare const stagehand: Stagehand;
          const zodSchema = z.object({ count: z.coerce.number() });
          const arkSchema = type({ name: "string" });
          const valibotSchema = toStandardJsonSchema(v.object({ active: v.boolean() }));
          const ProductJsonSchema = Type.Object({
            name: Type.String(),
            price: Type.Number(),
            note: Type.Optional(Type.String()),
          });
          const productSchema = jsonSchema<Static<typeof ProductJsonSchema>>(ProductJsonSchema);
          const unknownSchema = jsonSchema({
            type: "object",
            properties: { value: { type: "string" } },
          });
          type LocalConnect = z.infer<typeof LocalBrowserConnectOptionsSchema>;
          const localConnect: LocalConnect = { cdpUrl: "ws://127.0.0.1:9222" };
          LocalBrowserConnectOptionsSchema.shape.cdpUrl.parse(localConnect.cdpUrl);
          LocalBrowserConnectOptionsSchema.extend({}).pick({ cdpUrl: true }).safeParse(localConnect);

          const zodResult: Promise<ExtractResult<typeof zodSchema>> =
            stagehand.extract("count", zodSchema);
          const arkResult: Promise<ExtractResult<{ name: string }>> =
            stagehand.extract("name", arkSchema);
          const valibotResult: Promise<ExtractResult<{ active: boolean }>> =
            stagehand.extract("active", valibotSchema);
          const productResult: Promise<ExtractResult<Static<typeof ProductJsonSchema>>> =
            stagehand.extract("product", productSchema);
          const unknownResult: Promise<ExtractResult<unknown>> =
            stagehand.extract("unknown", unknownSchema);

          void [zodResult, arkResult, valibotResult, productResult, unknownResult, localConnect];
        `,
      );
      try {
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
            "--strict",
            "--skipLibCheck",
            "verify-ecosystems.ts",
          ],
          { cwd: consumerDirectory },
        );
      } catch (error) {
        const output = error as { stderr?: string; stdout?: string };
        throw new Error(
          output.stderr || output.stdout || "Ecosystem TypeScript compilation failed",
          { cause: error },
        );
      }
      await writeFile(
        path.join(consumerDirectory, "verify-ecosystems.mjs"),
        `
          import { Stagehand } from "@browserbasehq/stagehand";
          import { z } from "zod/v4";

          let sentSchema;
          const stagehand = Object.create(Stagehand.prototype);
          stagehand.isInitialized = true;
          stagehand.browserHandle = {
            context: { activePage: async () => ({ pageId: "page-1" }) },
          };
          stagehand.rpcClient = {
            send: async (_method, params) => {
              sentSchema = params.schema;
              return { data: { count: "2" }, metadata: {} };
            },
          };
          const result = await stagehand.extract(
            "count",
            z.object({ count: z.coerce.number().int() }),
          );
          if (sentSchema?.properties?.count?.type !== "integer") {
            throw new Error("Zod 4.2 schema was not converted before RPC");
          }
          if (result.data.count !== 2) {
            throw new Error("Zod 4.2 did not validate and transform the RPC result");
          }
        `,
      );
      await execFileAsync(
        process.execPath,
        [path.join(consumerDirectory, "verify-ecosystems.mjs")],
        {
          cwd: consumerDirectory,
        },
      );
      expect(
        JSON.parse(await readFile(path.join(consumerDirectory, "package.json"), "utf8")),
      ).toMatchObject({ private: true });
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  }, 120_000);
});
