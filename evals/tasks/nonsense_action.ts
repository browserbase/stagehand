import { EvalFunction } from "@/types/evals";

export const nonsense_action: EvalFunction = async ({ stagehand, logger }) => {
  try {
    await stagehand.page.goto("https://www.homedepot.com/");

    const result = await stagehand.page.act({
      action: "click on the first banana",
    });
    console.log("result", result);

    // Assert the output
    const expectedResult = {
      success: false,
      message: "Action was not able to be completed.",
      action: "click on the first banana",
    };

    const isResultCorrect =
      JSON.stringify(result) === JSON.stringify(expectedResult);

    return {
      _success: isResultCorrect,
      logs: logger.getLogs(),
    };
  } catch (error) {
    console.error(`Error in nonsense_action function: ${error.message}`);
    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
