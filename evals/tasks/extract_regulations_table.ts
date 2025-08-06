import { EvalFunction } from "@/types/evals";
import { z } from "zod/v3";

export const extract_regulations_table: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/ncc-numbering-plan/",
    );

    const xpath =
      "/html/body/div[3]/main/div[2]/div[2]/div/div/div[2]/article/div[2]/div[1]/div/table";

    const allottees = await stagehand.page.extract({
      instruction:
        "Extract ALL of the Allottees and their corresponding name, area, and area code.",
      schema: z.object({
        allottee_list: z.array(
          z.object({
            allottee_name: z.string(),
            area: z.string(),
            area_code: z.string(),
            access_code: z.string(),
          }),
        ),
      }),

      selector: xpath,
    });

    // Define the expected weather data
    const allottees_expected_first = {
      allottee_name: "101 Communications Limited",
      area: "Lagos",
      area_code: "0201",
      access_code: "249",
    };

    const allottees_expected_last = {
      allottee_name: "Airtel Networks Limited",
      area: "National",
      area_code: "0708",
      access_code: "708",
    };

    const expected_length = 25;

    const allotteeList = allottees.allottee_list;

    // Check that the first entry, last entry, and total number match expectations
    const isFirstCorrect =
      JSON.stringify(allotteeList[0]) ===
      JSON.stringify(allottees_expected_first);
    const isLastCorrect =
      JSON.stringify(allotteeList[allotteeList.length - 1]) ===
      JSON.stringify(allottees_expected_last);
    const isLengthCorrect = allotteeList.length === expected_length;

    const isRegulationsCorrect =
      isFirstCorrect && isLastCorrect && isLengthCorrect;

    return {
      _success: isRegulationsCorrect,
      regulationsData: allottees,
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
};
