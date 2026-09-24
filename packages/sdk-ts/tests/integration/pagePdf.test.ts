import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

describe("Page.pdf", () => {
  let stagehand: Stagehand;

  beforeEach(async () => {
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
  });

  it("renders CSS-sized pages, writes their bytes, and respects page ranges", async () => {
    const page = await firstPage(stagehand);
    const outputPath = path.join(os.tmpdir(), `stagehand-pdf-${Date.now()}.pdf`);
    await page.goto(
      `data:text/html,${encodeURIComponent(`
        <!doctype html>
        <style>
          @page { size: 4in 6in; margin: 0.5in; }
          body { background: #e8f1ff; color: #13213c; font-family: sans-serif; }
          h1 { color: #2458a6; }
          .second { break-before: page; }
        </style>
        <h1>Stagehand PDF verification</h1>
        <p>This content was rendered by Chrome through Stagehand.</p>
        <section class="second"><h2>Second page</h2><p>A second printed page.</p></section>
      `)}`,
    );

    try {
      const bytes = await page.pdf({
        displayHeaderFooter: true,
        footerTemplate:
          '<div style="font-size:8px;width:100%;text-align:center"><span class="pageNumber"></span>/<span class="totalPages"></span></div>',
        generateDocumentOutline: true,
        generateTaggedPDF: true,
        path: outputPath,
        preferCSSPageSize: true,
        printBackground: true,
      });

      expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
      expect(new TextDecoder().decode(bytes.subarray(-32))).toContain("%%EOF");
      expect(bytes.length).toBeGreaterThan(1_000);
      expect(await fs.readFile(outputPath)).toStrictEqual(Buffer.from(bytes));

      // Chrome emits page dictionaries outside the compressed content streams.
      const pdf = Buffer.from(bytes).toString("latin1");
      expect(pdf.match(/\/Type\s*\/Page\b/g)).toHaveLength(2);
      expect(pdf).toMatch(/\/MediaBox\s*\[0\s+0\s+288\s+432\]/);
      expect(pdf).toMatch(/\/Marked\s+true\b/);
      const secondPage = await page.pdf({ pageRanges: "2", preferCSSPageSize: true, timeout: 0 });
      expect(
        Buffer.from(secondPage)
          .toString("latin1")
          .match(/\/Type\s*\/Page\b/g),
      ).toHaveLength(1);
    } finally {
      await fs.rm(outputPath, { force: true });
    }
  });

  it("preserves print errors and allows subsequent captures", async () => {
    const page = await firstPage(stagehand);
    await page.goto("data:text/html,<h1>One page</h1>");

    await expect(page.pdf({ pageRanges: "0" })).rejects.toThrow(/page range/i);
    const bytes = await page.pdf();
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
    expect((await page.screenshot()).length).toBeGreaterThan(0);
  });
});
