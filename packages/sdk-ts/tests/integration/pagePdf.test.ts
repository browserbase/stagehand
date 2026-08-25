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

  async function openSimplePage() {
    const page = await firstPage(stagehand);
    await page.goto(
      `data:text/html,${encodeURIComponent(`<style>body{background:#00ff00}</style><h1>pdf me</h1>`)}`,
    );
    return page;
  }

  it("renders default PDF bytes", async () => {
    const page = await openSimplePage();
    const bytes = await page.pdf();
    expect(bytes.length).toBeGreaterThan(500);
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(Buffer.from(bytes.subarray(-64)).toString().trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("writes the pdf to path and returns its bytes", async () => {
    const page = await openSimplePage();
    const outputPath = path.join(os.tmpdir(), `stagehand-page-${Date.now()}.pdf`);
    try {
      const bytes = await page.pdf({ format: "a4", printBackground: true, path: outputPath });
      expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
      expect((await fs.stat(outputPath)).size).toBe(bytes.length);
    } finally {
      await fs.rm(outputPath, { force: true });
    }
  });

  it("accepts landscape, margins, and page ranges", async () => {
    const page = await openSimplePage();
    const bytes = await page.pdf({
      landscape: true,
      margin: { top: "1cm", right: 24 },
      pageRanges: "1",
    });
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
  });

  it("accepts header/footer templates with displayHeaderFooter", async () => {
    const page = await openSimplePage();
    const bytes = await page.pdf({
      displayHeaderFooter: true,
      headerTemplate: "<span class=title></span>",
      footerTemplate: "<span class=pageNumber></span>",
      tagged: true,
      outline: true,
    });
    expect(bytes.length).toBeGreaterThan(500);
  });

  it("rejects out-of-range scale", async () => {
    const page = await openSimplePage();
    await expect(page.pdf({ scale: 3 })).rejects.toThrow(/scale/i);
  });

  it("rejects unknown options", async () => {
    const page = await openSimplePage();
    await expect(page.pdf({ paperSize: "big" } as never)).rejects.toThrow();
  });

  it("rejects invalid margin lengths", async () => {
    const page = await openSimplePage();
    await expect(page.pdf({ margin: { top: "10pt" } })).rejects.toThrow(/length/i);
  });
});
