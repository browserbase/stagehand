import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "extract_repo_name" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://github.com/facebook/react");

      // v3 used schemaless extract; v4 requires a schema.
      // Single-word key to stay clear of the snake_case wire-casing bug (#14).
      const {
        data: { extraction },
      } = await stagehand.extract(
        "extract the title of the Github repository. Do not include the owner of the repository.",
        z.object({ extraction: z.string() }),
      );

      logger.log({
        message: "Extracted repo title",
        level: 1,
        auxiliary: {
          repo_name: {
            value: extraction,
            type: "object",
          },
        },
      });

      return {
        _success: extraction === "react",
        extraction,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        error: error instanceof Error ? error.message : String(error),
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
