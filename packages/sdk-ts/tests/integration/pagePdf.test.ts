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
        outline: true,
        tagged: true,
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
      expect(pdf).toMatch(/\/Outlines\s+\d+\s+\d+\s+R\b/);
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

  it("uses inch dimensions, zero default margins, and opt-in tags and outlines", async () => {
    const page = await firstPage(stagehand);
    await page.goto(
      `data:text/html,${encodeURIComponent(`
        <!doctype html>
        <style>
          html, body { margin: 0; padding: 0; }
          section { height: 5.75in; background: #e8f1ff; }
          h1 { margin: 0; }
        </style>
        <section><h1>PDF defaults</h1><p>A nearly page-height block.</p></section>
      `)}`,
    );

    const pdf = Buffer.from(await page.pdf({ width: 4, height: 6 })).toString("latin1");
    expect(pdf).toMatch(/\/MediaBox\s*\[0\s+0\s+288\s+432\]/);
    expect(pdf.match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
    expect(pdf).not.toMatch(/\/Marked\s+true\b/);
    expect(pdf).not.toMatch(/\/Outlines\s+\d+\s+\d+\s+R\b/);

    const withMargins = Buffer.from(
      await page.pdf({ width: 4, height: 6, margin: { top: 0.5, bottom: 0.5 } }),
    ).toString("latin1");
    expect(withMargins.match(/\/Type\s*\/Page\b/g)).toHaveLength(2);
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
