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

  it("renders a valid PDF and writes the same bytes to disk", async () => {
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
        <section class="second"><h2>Second page</h2><p>Page ranges and CSS sizing are active.</p></section>
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
    } finally {
      await fs.rm(outputPath, { force: true });
    }
  });
});
