import { expect, test } from "@playwright/test";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import type { ToolCallOptions } from "ai";
import { V3 } from "../../lib/v3/v3.js";
import { v3TestConfig } from "./v3.config.js";
import { createAgentTools } from "../../lib/v3/agent/tools/index.js";

const FILE_UPLOAD_V2_URL =
  "https://browserbase.github.io/stagehand-eval-sites/sites/file-uploads-2/";

const RESUME_INPUT = "#resumeUpload";
const RESUME_SUCCESS = "#resumeSuccess";
const toolCallOptions: ToolCallOptions = {
  toolCallId: "upload-integration-call",
  messages: [],
};

type UploadTool = {
  execute: (
    input: {
      target: string;
      paths: string[];
    },
    options: ToolCallOptions,
  ) => Promise<{
    success: boolean;
    selector?: string;
    files?: string[];
    error?: string;
  }>;
};

test.describe("Stagehand agent upload tool", () => {
  let v3: V3;
  const fixtures: string[] = [];

  test.beforeEach(async () => {
    v3 = new V3({
      ...v3TestConfig,
      experimental: true,
    });
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
    await Promise.all(
      fixtures.splice(0).map((file) => fs.unlink(file).catch(() => {})),
    );
  });

  const createFixture = async (
    namePrefix: string,
    contents: string,
    ext = ".txt",
  ): Promise<string> => {
    const normalizedExt = ext.startsWith(".") ? ext : `.${ext}`;
    const filename = `${namePrefix}-${crypto.randomBytes(4).toString("hex")}${normalizedExt}`;
    const filePath = path.resolve(process.cwd(), filename);
    await fs.writeFile(filePath, contents, "utf-8");
    fixtures.push(filePath);
    return filePath;
  };

  const getUploadTool = (): UploadTool =>
    createAgentTools(v3, {
      mode: "dom",
      toolTimeout: 45_000,
    }).upload as unknown as UploadTool;

  test("uploads a resume by targeting the file input semantically", async () => {
    test.setTimeout(90_000);

    const page = v3.context.pages()[0];
    await page.goto(FILE_UPLOAD_V2_URL);
    const fixture = await createFixture(
      "resume-agent",
      "<p>resume</p>",
      ".pdf",
    );

    const result = await getUploadTool().execute(
      {
        target: "the Resume file upload input",
        paths: [fixture],
      },
      toolCallOptions,
    );

    expect(result.success).toBe(true);
    expect(result.selector).toBeTruthy();
    expect(result.files).toEqual([path.basename(fixture)]);

    await expect
      .poll(
        () =>
          page.evaluate((selector) => {
            const el = document.querySelector(selector);
            if (!el) return "";
            const display = window.getComputedStyle(el).display;
            if (display === "none") return "";
            return el.textContent ?? "";
          }, RESUME_SUCCESS),
        { message: "wait for resume upload success" },
      )
      .toContain("Resume uploaded!");

    await expect
      .poll(
        () =>
          page.evaluate((selector) => {
            const el = document.querySelector(selector);
            if (!(el instanceof HTMLInputElement)) return 0;
            return el.files?.length ?? 0;
          }, RESUME_INPUT),
        { message: "wait for resume file count" },
      )
      .toBe(1);
  });

  test("returns a helpful error when the local file path does not exist", async () => {
    test.setTimeout(90_000);

    const page = v3.context.pages()[0];
    await page.goto(FILE_UPLOAD_V2_URL);

    const missingPath = path.resolve(
      process.cwd(),
      `missing-upload-${crypto.randomBytes(4).toString("hex")}.pdf`,
    );

    const result = await getUploadTool().execute(
      {
        target: "the Resume file upload input",
        paths: [missingPath],
      },
      toolCallOptions,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("file not found");
  });
});
