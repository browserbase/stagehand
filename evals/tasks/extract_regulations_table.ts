import { EvalFunction } from "@/types/evals";
import { initStagehand } from "@/evals/initStagehand";
import { z } from "zod";

export const extract_regulations_table: EvalFunction = async ({
  modelName,
  logger,
  useTextExtract,
}) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  try {
    await stagehand.page.goto(
      "https://www.ncc.gov.ng/technical-regulation/standards/numbering",
    );

    const xpath =
      "/html/body/div[2]/section[4]/div/div/div[1]/main/div[2]/div/div/div/div/div/div/div[2]/div[2]/div[3]/div[1]";

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
      modelName,
      useTextExtract,
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
      allottee_name: "21st Century Technologies Limited",
      area: "Lagos",
      area_code: "0201",
      access_code: "278",
    };

    const expected_length = 10;

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

    await stagehand.close();

    return {
      _success: isRegulationsCorrect,
      regulationsData: allottees,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    console.error("Error or timeout occurred:", error);

    await stagehand.close();

    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  }
};
