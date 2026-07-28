import { z } from "zod";
import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "extract_repo_name" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://github.com/facebook/react");

      // v3 used schemaless extract (V4_API_LOGS #2); v4 requires a schema.
      // Single-word key to stay clear of the snake_case wire-casing bug (#14).
      const { extraction } = await stagehand.extract(
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
        error: JSON.parse(JSON.stringify(error, null, 2)),
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
