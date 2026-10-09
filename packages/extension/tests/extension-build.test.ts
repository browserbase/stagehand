import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync, type Zippable } from "fflate";
import { build, loadEnv } from "vite";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { STAGEHAND_PROTOCOL_VERSION } from "../../protocol/schemas.js";
import extensionPackageJson from "../package.json" with { type: "json" };
import { stagehandExtensionBuildConfig, validateBrowserProxyOrigin } from "../vite.config.ts";

const stagehandExtensionDistDir = fileURLToPath(new URL("../dist", import.meta.url));
const extensionRoot = fileURLToPath(new URL("..", import.meta.url));
const stagehandExtensionArchive = fileURLToPath(
  new URL("../artifacts/stagehand-extension.zip", import.meta.url),
);
const stagehandExtensionMetadata = fileURLToPath(
  new URL("../artifacts/stagehand-extension.metadata.json", import.meta.url),
);
const stagehandExtensionSourceManifest = fileURLToPath(
  new URL("../manifest.json", import.meta.url),
);
const expectedManifestVersion = extensionPackageJson.version.replace(/[+-].*$/u, "");

const ManifestSchema = z.looseObject({
  manifest_version: z.literal(3),
  name: z.string(),
  key: z.string().min(1),
  version: z.string(),
  minimum_chrome_version: z.literal("116"),
  permissions: z.array(z.string()),
  host_permissions: z.array(z.string()),
  background: z.object({
    service_worker: z.string(),
    type: z.literal("module"),
  }),
  content_scripts: z.array(
    z.object({
      matches: z.array(z.string()),
      js: z.array(z.string()),
      run_at: z.literal("document_start"),
      all_frames: z.literal(true),
      world: z.literal("ISOLATED"),
      match_about_blank: z.literal(true),
      match_origin_as_fallback: z.literal(true),
    }),
  ),
  options_page: z.string(),
});

describe("extension build", () => {
  it("injects the extension package version instead of storing a manifest placeholder", async () => {
    const sourceManifest = JSON.parse(
      await readFile(stagehandExtensionSourceManifest, "utf8"),
    ) as Record<string, unknown>;
    const builtManifest = ManifestSchema.parse(
      JSON.parse(await readFile(path.join(stagehandExtensionDistDir, "manifest.json"), "utf8")),
    );

    expect(sourceManifest).not.toHaveProperty("version");
    expect(builtManifest.version).toBe(expectedManifestVersion);
  });

  it("has a loadable MV3 extension artifact", async () => {
    const manifest = ManifestSchema.parse(
      JSON.parse(await readFile(path.join(stagehandExtensionDistDir, "manifest.json"), "utf8")),
    );
    const serviceWorker = await readFile(
      path.join(stagehandExtensionDistDir, "service-worker.js"),
      "utf8",
    );
    const contentScript = await readFile(
      path.join(stagehandExtensionDistDir, "content-script.js"),
      "utf8",
    );
    const blankPage = await readFile(path.join(stagehandExtensionDistDir, "blank.html"), "utf8");
    const wakeServiceWorkerHtml = await readFile(
      path.join(stagehandExtensionDistDir, "wake-service-worker.html"),
      "utf8",
    );
    const wakeServiceWorkerScript = await readFile(
      path.join(stagehandExtensionDistDir, "wake-service-worker.js"),
      "utf8",
    );
    const offscreenHtml = await readFile(
      path.join(stagehandExtensionDistDir, "offscreen/service-worker-heartbeat.html"),
      "utf8",
    );
    const offscreenScript = await readFile(
      path.join(stagehandExtensionDistDir, "offscreen/service-worker-heartbeat.js"),
      "utf8",
    );

    expect(manifest).toMatchObject({
      manifest_version: 3,
      name: "Stagehand Runtime",
      version: expectedManifestVersion,
      minimum_chrome_version: "116",
      background: {
        service_worker: "service-worker.js",
        type: "module",
      },
      content_scripts: [
        {
          matches: ["<all_urls>"],
          js: ["content-script.js"],
          run_at: "document_start",
          all_frames: true,
          world: "ISOLATED",
          match_about_blank: true,
          match_origin_as_fallback: true,
        },
      ],
      options_page: "wake-service-worker.html",
    });
    expect(manifest.permissions).toEqual(["debugger", "offscreen"]);
    expect(manifest.host_permissions).toEqual(["<all_urls>"]);
    expect(serviceWorker).toContain("__stagehandReceiveFromHost");
    expect(serviceWorker).toContain("offscreen/service-worker-heartbeat.html");
    expect(serviceWorker).toContain("OFFSCREEN_DOCUMENT");
    expect(contentScript).toContain("__stagehandExtensionWorld");
    expect(contentScript).toContain("stagehand.v4");
    expect(contentScript).toContain("installCursorOverlay");
    expect(contentScript).not.toContain("fillElementValue");
    expect(contentScript).not.toContain("__v3Cursor");
    expect(contentScript).not.toMatch(/^import\s/m);
    expect(contentScript).not.toContain("__vite-browser-external");
    expect(blankPage).toContain('src="content-script.js"');
    expect(wakeServiceWorkerHtml).toContain("wake-service-worker.js");
    expect(wakeServiceWorkerScript).toContain("stagehand_wake_service_worker");
    expect(offscreenHtml).toContain("service-worker-heartbeat.js");
    expect(offscreenScript).toContain("StagehandExtensionServiceWorkerHeartbeat");
    expect(serviceWorker).not.toContain("src/shims");
    expect(serviceWorker).toContain("new WebSocket");
    expect(serviceWorker).toMatch(/binaryType\s*=\s*[`"']arraybuffer[`"']/u);
    expect(serviceWorker).not.toContain("__vite-browser-external");
    expect(serviceWorker).not.toContain("__vite_browser_external");
    expect(serviceWorker).not.toContain("Node WebSocket transport is unavailable");
    expect(serviceWorker).not.toContain("__v3Cursor");
    expect(JSON.stringify(manifest)).not.toContain("stagehand-smoke-worker");
  });

  it("writes a ZIP containing the built extension", async () => {
    const archiveBytes = await readFile(stagehandExtensionArchive);
    const archive = unzipSync(archiveBytes);
    const builtFiles = await readBuiltExtensionFiles(stagehandExtensionDistDir);
    expect(Object.keys(archive).toSorted()).toEqual(Object.keys(builtFiles).toSorted());
    for (const [relativePath, contents] of Object.entries(builtFiles)) {
      expect(archive[relativePath], relativePath).toEqual(Uint8Array.from(contents));
    }
    expect(JSON.parse(new TextDecoder().decode(archive["manifest.json"]))).toMatchObject({
      manifest_version: 3,
      version: expectedManifestVersion,
    });
    const archivedManifest = ManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(archive["manifest.json"])),
    );
    const MetadataSchema = z.strictObject({
      chromeExtensionId: z.literal("hgibfbbnmoigailpmgihnbaokiinpmij"),
      extensionVersion: z.literal(expectedManifestVersion),
      stagehandProtocolVersion: z.literal(STAGEHAND_PROTOCOL_VERSION),
      residentGatewayConfigured: z.boolean(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/u),
      unpackedSha256: z.string().regex(/^[0-9a-f]{64}$/u),
      serviceWorkerPath: z.literal("service-worker.js"),
      sourceCommit: z.string().regex(/^[0-9a-f]{40}$/u),
    });
    const metadata = MetadataSchema.parse(
      JSON.parse(await readFile(stagehandExtensionMetadata, "utf8")),
    );
    const configuredBrowserProxyUrl =
      process.env.VITE_STAGEHAND_BROWSER_PROXY_URL ??
      loadEnv("production", extensionRoot, "VITE_STAGEHAND_").VITE_STAGEHAND_BROWSER_PROXY_URL;
    expect(metadata.chromeExtensionId).toBe(chromeExtensionId(archivedManifest.key));
    expect(metadata.residentGatewayConfigured).toBe(Boolean(configuredBrowserProxyUrl?.trim()));
    expect(metadata.sha256).toBe(sha256(archiveBytes));
    expect(metadata.unpackedSha256).toBe(unpackedFilesSha256(builtFiles));

    const deterministicEntries: Zippable = {};
    for (const relativePath of Object.keys(builtFiles).toSorted()) {
      deterministicEntries[relativePath] = [
        builtFiles[relativePath]!,
        { attrs: 0o644 << 16, mtime: new Date(1980, 0, 1), os: 3 },
      ];
    }
    expect(sha256(archiveBytes)).toBe(sha256(zipSync(deterministicEntries, { level: 9 })));
  }, 30_000);

  it("produces byte-identical artifacts from identical inputs", async () => {
    const firstRoot = await mkdtemp(path.join(tmpdir(), "stagehand-extension-build-first-"));
    const secondRoot = await mkdtemp(path.join(tmpdir(), "stagehand-extension-build-second-"));
    // Vite bakes process.env.NODE_ENV into the bundle; vitest sets it to "test", while the
    // canonical `vite build` runs with "production".
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      for (const temporaryRoot of [firstRoot, secondRoot]) {
        await build({
          configFile: false,
          logLevel: "silent",
          ...stagehandExtensionBuildConfig({
            mode: "production",
            outDir: path.join(temporaryRoot, "dist"),
            artifactsDir: path.join(temporaryRoot, "artifacts"),
          }),
        });
      }
      const firstArchive = await readFile(
        path.join(firstRoot, "artifacts/stagehand-extension.zip"),
      );
      const secondArchive = await readFile(
        path.join(secondRoot, "artifacts/stagehand-extension.zip"),
      );
      const firstMetadata = await readFile(
        path.join(firstRoot, "artifacts/stagehand-extension.metadata.json"),
      );
      const secondMetadata = await readFile(
        path.join(secondRoot, "artifacts/stagehand-extension.metadata.json"),
      );
      expect(firstArchive).toEqual(secondArchive);
      expect(firstMetadata).toEqual(secondMetadata);
      expect(sha256(firstArchive)).toBe(sha256(await readFile(stagehandExtensionArchive)));
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      await Promise.all([
        rm(firstRoot, { force: true, recursive: true }),
        rm(secondRoot, { force: true, recursive: true }),
      ]);
    }
  }, 120_000);

  it.each(["http://127.0.0.1:9224", "https://localhost", "http://[::1]:9224"])(
    "accepts a loopback browser proxy origin: %s",
    (origin) => {
      expect(() => validateBrowserProxyOrigin(origin)).not.toThrow();
    },
  );

  it.each([
    "ws://127.0.0.1:9224",
    "http://browser.example:9224",
    "http://127.0.0.1:9224/path",
    "http://user:secret@127.0.0.1:9224",
    "http://127.0.0.1:9224/?x=1",
    "http://127.0.0.1:9224/#frag",
    "127.0.0.1:9224",
  ])("rejects an invalid browser proxy origin: %s", (origin) => {
    expect(() => validateBrowserProxyOrigin(origin)).toThrow();
  });
});

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function chromeExtensionId(publicKey: string): string {
  return createHash("sha256")
    .update(Buffer.from(publicKey, "base64"))
    .digest("hex")
    .slice(0, 32)
    .replace(/[0-9a-f]/gu, (digit) =>
      String.fromCharCode("a".charCodeAt(0) + Number.parseInt(digit, 16)),
    );
}

function unpackedFilesSha256(files: Record<string, Uint8Array>): string {
  const digest = createHash("sha256");
  for (const relativePath of Object.keys(files).sort(compareCodePoints)) {
    digest.update(`${relativePath}\n${sha256(files[relativePath]!)}\n`);
  }
  return digest.digest("hex");
}

async function readBuiltExtensionFiles(
  directory: string,
  relativeDirectory = "",
): Promise<Record<string, Uint8Array>> {
  const entries = await readdir(path.join(directory, relativeDirectory), { withFileTypes: true });
  const files: Record<string, Uint8Array> = {};

  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      Object.assign(files, await readBuiltExtensionFiles(directory, relativePath));
    } else if (entry.isFile()) {
      files[relativePath.split(path.sep).join("/")] = await readFile(
        path.join(directory, relativePath),
      );
    }
  }

  return files;
}

// UTF-8 byte order equals Unicode code point order, matching Python's `sorted()` in build.py.
function compareCodePoints(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
