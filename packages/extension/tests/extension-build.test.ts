import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod/v4";

const stagehandExtensionDistDir = new URL("../dist", import.meta.url).pathname;

const ManifestSchema = z.looseObject({
  manifest_version: z.literal(3),
  name: z.string(),
  minimum_chrome_version: z.literal("116"),
  permissions: z.array(z.string()),
  host_permissions: z.array(z.string()),
  background: z.object({
    service_worker: z.string(),
    type: z.literal("module"),
  }),
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
      minimum_chrome_version: "116",
      background: {
        service_worker: "service-worker.js",
        type: "module",
      },
      options_page: "wake-service-worker.html",
    });
    expect(manifest.permissions).toEqual(["offscreen", "scripting", "tabs"]);
    expect(manifest.host_permissions).toEqual(["<all_urls>"]);
    expect(serviceWorker).toContain("__stagehandReceiveFromHost");
    expect(serviceWorker).toContain("offscreen/service-worker-heartbeat.html");
    expect(serviceWorker).toContain("OFFSCREEN_DOCUMENT");
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
    expect(JSON.stringify(manifest)).not.toContain("stagehand-smoke-worker");
  });
});
