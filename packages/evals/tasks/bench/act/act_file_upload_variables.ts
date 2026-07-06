import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { defineBenchTask } from "../../../framework/defineTask.js";

const FILE_UPLOAD_V2_URL =
  "https://browserbase.github.io/stagehand-eval-sites/sites/file-uploads-2/";
const RESUME_INPUT = "#resumeUpload";
const RESUME_SUCCESS = "#resumeSuccess";

export default defineBenchTask(
  { name: "act_file_upload_variables" },
  async ({ debugUrl, sessionUrl, v3, logger }) => {
    const fixturePath = path.resolve(
      process.cwd(),
      `eval-resume-${crypto.randomBytes(4).toString("hex")}.pdf`,
    );

    try {
      await fs.writeFile(fixturePath, "resume", "utf-8");

      const page = v3.context.pages()[0];
      await page.goto(FILE_UPLOAD_V2_URL);

      const result = await v3.act("upload %resume% to the resume field", {
        variables: { resume: fixturePath },
      });

      if (!result.success) {
        return {
          _success: false,
          message: result.message || "act() did not report success",
          result,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      const usedSetInputFiles = result.actions.some(
        (action) => action.method === "setInputFiles",
      );
      if (!usedSetInputFiles) {
        return {
          _success: false,
          message: 'act() succeeded but did not use the "setInputFiles" method',
          result,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      const successText = await page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (!el) return "";
        const display = window.getComputedStyle(el).display;
        if (display === "none") return "";
        return el.textContent ?? "";
      }, RESUME_SUCCESS);

      const fileCount = await page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (!(el instanceof HTMLInputElement)) return 0;
        return el.files?.length ?? 0;
      }, RESUME_INPUT);

      const uploaded =
        successText.includes("Resume uploaded!") && fileCount === 1;

      return {
        _success: uploaded,
        message: uploaded
          ? undefined
          : `expected resume upload confirmation and one file on input (success="${successText}", fileCount=${fileCount})`,
        result,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        error,
        message:
          error instanceof Error
            ? error.message
            : "act() file upload via variables failed",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      try {
        await v3.close();
      } finally {
        await fs.unlink(fixturePath).catch(() => {});
      }
    }
  },
);
