import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localBrowser, Stagehand } from "../src/index.js";

const directory = await mkdtemp(join(tmpdir(), "stagehand-upload-"));

try {
  const filePath = join(directory, "hello.txt");
  await writeFile(filePath, "hello from TypeScript");

  const browser = await localBrowser.launch({ headless: true });
  try {
    const stagehand = await Stagehand.create({ browser });
    try {
      const page = await browser.context.activePage();
      if (!page) throw new Error("Stagehand initialized without an active page");

      await page.goto(`data:text/html,${encodeURIComponent('<input id="upload" type="file">')}`);
      await page.locator("#upload").setInputFiles(filePath);

      const uploaded = (await page.evaluate(`(async () => {
        const file = document.querySelector('#upload').files[0];
        return file ? { name: file.name, text: await file.text() } : null;
      })()`)) as { name: string; text: string } | null;
      if (uploaded?.name !== "hello.txt" || uploaded.text !== "hello from TypeScript") {
        throw new Error(`Unexpected uploaded file: ${JSON.stringify(uploaded)}`);
      }
      console.log(uploaded);
    } finally {
      await stagehand.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
