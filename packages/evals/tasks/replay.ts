import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import type { Page } from "@browserbasehq/stagehand";

export type RecordedTaskName =
  | "aigrant"
  | "file-uploads-3"
  | "csa"
  | "ionwave"
  | "professional-info"
  | "resistor";

/** Load a reviewed recording without depending on a server reachable by the browser. */
export async function gotoRecordedTask(page: Page, name: RecordedTaskName): Promise<void> {
  const directory = new URL(`../assets/observation-tasks/${name}/`, import.meta.url);
  const [compressed, metadata] = await Promise.all([
    readFile(new URL("index.html.gz", directory)),
    readFile(new URL("manifest.json", directory), "utf8"),
  ]);
  const manifest = JSON.parse(metadata) as { viewport: { width: number; height: number } };
  await page.setViewportSize(manifest.viewport.width, manifest.viewport.height);
  const html = gunzipSync(compressed).toString("utf8");
  // Send large captures over RPC rather than in the navigation URL. This needs
  // no browser-local file path or HTTP server.
  await page.goto("about:blank");
  await page.evaluate((content) => {
    document.open();
    document.write(content);
    document.close();
  }, html);
}
