import { expect, test } from "@playwright/test";
import { Buffer } from "buffer";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import type { Page as V3Page } from "../understudy/page";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";

const FILE_UPLOAD_IFRAME_URL =
  "https://browserbase.github.io/stagehand-eval-sites/sites/file-uploads-iframe/";
const FILE_UPLOAD_V2_URL =
  "https://browserbase.github.io/stagehand-eval-sites/sites/file-uploads-2/";

const RESUME_INPUT = "#resumeUpload";
const RESUME_SUCCESS = "#resumeSuccess";
const IMAGES_INPUT = "#imagesUpload";
const IMAGES_SUCCESS = "#imagesSuccess";
const AUDIO_INPUT = "#audioUpload";
const AUDIO_SUCCESS = "#audioSuccess";
const IFRAME_UPLOAD_INPUT = "/html/body/div/iframe/html/body/div/div[1]/input";
const IFRAME_SUCCESS =
  "body > div > iframe >> html > body > div > div:nth-of-type(2)";

test.describe("tests setInputFiles()", () => {
  let v3: V3;
  const fixtures: string[] = [];

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
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

  const expectUploadSuccess = async (
    page: V3Page,
    successSelector: string,
    expectedText: string,
  ) => {
    await expect
      .poll(
        () =>
          page.evaluate((selector) => {
            const el = document.querySelector(selector);
            if (!el) return "";
            const display = window.getComputedStyle(el).display;
            if (display === "none") return "";
            return el.textContent ?? "";
          }, successSelector),
        { message: `wait for success message at ${successSelector}` },
      )
      .toContain(expectedText);
  };

  const getInputFileCount = async (page: V3Page, inputSelector: string) => {
    return await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (!(el instanceof HTMLInputElement)) return 0;
      return el.files?.length ?? 0;
    }, inputSelector);
  };

  const expectFileCount = async (
    page: V3Page,
    inputSelector: string,
    expected: number,
  ) => {
    await expect
      .poll(() => getInputFileCount(page, inputSelector), {
        message: `wait for file count on ${inputSelector}`,
      })
      .toBe(expected);
  };

  test("deepLocator uploads and validates within iframe", async () => {
    const page = v3.context.pages()[0];
    await page.goto(FILE_UPLOAD_IFRAME_URL);
    const fixture = await createFixture(
      "iframe-upload",
      "<p>iframe upload</p>",
      ".txt",
    );
    await page
      .deepLocator(IFRAME_UPLOAD_INPUT)
      .setInputFiles(path.relative(process.cwd(), fixture));

    const successLocator = page.deepLocator(IFRAME_SUCCESS);
    await expect
      .poll(async () => (await successLocator.textContent()) ?? "", {
        message: "wait for iframe upload success",
      })
      .toContain("file uploaded successfully");
  });

  test("locator uploads resume via relative path string", async () => {
    const page = v3.context.pages()[0];
    await page.goto(FILE_UPLOAD_V2_URL);
    const fixture = await createFixture("resume", "<p>resume</p>", ".pdf");
    await page
      .locator(RESUME_INPUT)
      .setInputFiles(path.relative(process.cwd(), fixture));
    await expectUploadSuccess(page, RESUME_SUCCESS, "Resume uploaded!");
    await expectFileCount(page, RESUME_INPUT, 1);
  });

  test("locator uploads multiple images via absolute paths", async () => {
    const page = v3.context.pages()[0];
    await page.goto(FILE_UPLOAD_V2_URL);
    const first = await createFixture("image-a", "<p>A</p>", ".png");
    const second = await createFixture("image-b", "<p>B</p>", ".jpeg");
    await page.locator(IMAGES_INPUT).setInputFiles([first, second]);
    await expectUploadSuccess(page, IMAGES_SUCCESS, "Images uploaded!");
    await expectFileCount(page, IMAGES_INPUT, 2);
  });

  test("locator uploads audio via payload object", async () => {
    const page = v3.context.pages()[0];
    await page.goto(FILE_UPLOAD_V2_URL);
    await page.locator(AUDIO_INPUT).setInputFiles({
      name: "voice-sample.mp3",
      mimeType: "audio/mpeg",
      buffer: Buffer.from("fake audio bytes", "utf-8"),
    });
    await expectUploadSuccess(page, AUDIO_SUCCESS, "Audio file uploaded!");
    await expectFileCount(page, AUDIO_INPUT, 1);
  });

  test("locator uploads multiple payload objects to images input", async () => {
    const page = v3.context.pages()[0];
    await page.goto(FILE_UPLOAD_V2_URL);
    await page.locator(IMAGES_INPUT).setInputFiles([
      {
        name: "payload-a.png",
        mimeType: "image/png",
        buffer: Buffer.from("payload-a", "utf-8"),
      },
      {
        name: "payload-b.png",
        mimeType: "image/png",
        buffer: Buffer.from("payload-b", "utf-8"),
      },
    ]);
    await expectUploadSuccess(page, IMAGES_SUCCESS, "Images uploaded!");
    await expectFileCount(page, IMAGES_INPUT, 2);
  });
});
