import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync, type Zippable } from "fflate";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod/v4";
import serverPackageJson from "../package.json" with { type: "json" };

const stagehandExtensionDistDir = fileURLToPath(new URL("../dist", import.meta.url));
const stagehandExtensionArchive = fileURLToPath(
  new URL("../artifacts/stagehand-extension.zip", import.meta.url),
);
const expectedManifestVersion = serverPackageJson.version.replace(/[+-].*$/u, "");

const ManifestSchema = z.looseObject({
  manifest_version: z.literal(3),
  name: z.string(),
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
    expect(manifest.permissions).toEqual(["debugger", "offscreen", "scripting", "tabs"]);
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
    expect(serviceWorker).toContain('binaryType = "arraybuffer"');
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

    const deterministicEntries: Zippable = {};
    for (const relativePath of Object.keys(builtFiles).toSorted()) {
      deterministicEntries[relativePath] = [
        builtFiles[relativePath]!,
        { attrs: 0o644 << 16, mtime: new Date(1980, 0, 1), os: 3 },
      ];
    }
    expect(sha256(archiveBytes)).toBe(sha256(zipSync(deterministicEntries, { level: 9 })));
  }, 30_000);
});

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
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
