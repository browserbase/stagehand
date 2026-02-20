import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { EvalFunction } from "../types/evals";

const FILE_UPLOAD_V2_URL =
  "https://browserbase.github.io/stagehand-eval-sites/sites/file-uploads-2/";
const RESUME_INPUT = "#resumeUpload";
const RESUME_SUCCESS = "#resumeSuccess";

async function waitForResumeUploadSuccess(page: {
  evaluate: (
    fn: (selector: string) => boolean,
    selector: string,
  ) => Promise<boolean>;
}): Promise<boolean> {
  const timeoutMs = 8000;
  const intervalMs = 200;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const display = window.getComputedStyle(el).display;
      if (display === "none") return false;
      const text = (el.textContent ?? "").toLowerCase();
      return text.includes("resume uploaded");
    }, RESUME_SUCCESS);
    if (ok) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

export const observe_file_input_upload: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  const fixturePath = path.resolve(
    process.cwd(),
    `observe-file-upload-${crypto.randomBytes(4).toString("hex")}.pdf`,
  );

  try {
    const page = v3.context.pages()[0];
    await page.goto(FILE_UPLOAD_V2_URL);
    await fs.writeFile(
      fixturePath,
      "stagehand observe file upload test",
      "utf8",
    );

    const observations = await v3.observe(
      "Find the resume file upload input element. Return the actual upload input field, not the submit button.",
    );

    // Unpack the first observed action and use its xpath selector for setInputFiles().
    const [resumeUploadInput] = observations;
    if (!resumeUploadInput?.selector) {
      return {
        _success: false,
        error: "observe() did not return a file input selector",
        observations,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    const xpath = resumeUploadInput.selector;
    await page.locator(xpath).setInputFiles(fixturePath);

    const uploadSuccess = await waitForResumeUploadSuccess(page);
    const fileCount = await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (!(el instanceof HTMLInputElement)) return 0;
      return el.files?.length ?? 0;
    }, RESUME_INPUT);

    return {
      _success: uploadSuccess && fileCount > 0,
      xpath,
      fileCount,
      observations,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    return {
      _success: false,
      error,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await fs.unlink(fixturePath).catch(() => {});
    await v3.close();
  }
};
