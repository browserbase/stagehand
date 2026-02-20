/**
 * Observe file input example:
 * 1. Use observe() to get the xpath selector for the upload input.
 * 2. Unpack the first observed result.
 * 3. Pass that xpath into page.locator().setInputFiles().
 */
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { Stagehand } from "../lib/v3";

const FILE_UPLOAD_V2_URL =
  "https://browserbase.github.io/stagehand-eval-sites/sites/file-uploads-2/";
const RESUME_SUCCESS = "#resumeSuccess";

async function observeFileInputUpload() {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    verbose: 1,
  });

  const fixturePath = path.resolve(
    process.cwd(),
    `observe-file-upload-example-${crypto.randomBytes(4).toString("hex")}.txt`,
  );

  await stagehand.init();
  const page = stagehand.context.pages()[0];

  try {
    await fs.writeFile(
      fixturePath,
      "Stagehand observe() + setInputFiles() example",
      "utf8",
    );
    await page.goto(FILE_UPLOAD_V2_URL);

    const observations = await stagehand.observe(
      "Find the resume file upload input element. Return the actual upload input field.",
    );

    // Unpack the result and use the observed xpath directly.
    const [resumeUploadInput] = observations;
    if (!resumeUploadInput?.selector) {
      throw new Error("observe() did not return a file input selector");
    }
    const xpath = resumeUploadInput.selector;
    await page.locator(xpath).setInputFiles(fixturePath);

    const uploaded = await page.evaluate((selector) => {
      const success = document.querySelector(selector);
      if (!success) return false;
      const text = (success.textContent ?? "").toLowerCase();
      return text.includes("resume uploaded");
    }, RESUME_SUCCESS);

    if (!uploaded) {
      throw new Error("upload confirmation not found");
    }
    console.log(`Uploaded fixture with selector: ${xpath}`);
  } finally {
    await stagehand.close();
    await fs.unlink(fixturePath).catch(() => {});
  }
}

(async () => {
  await observeFileInputUpload();
})();
