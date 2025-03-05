import { z } from "zod";
import { initStagehand } from "@/evals/initStagehand";
import { EvalFunction } from "@/types/evals";

export const extract_geniusee_2: EvalFunction = async ({
  modelName,
  logger,
  useTextExtract,
}) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
    domSettleTimeoutMs: 3000,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto("https://geniusee-blog.surge.sh/single-blog/");
  const selector = "/html/body/main/div[2]/div[2]/div[2]/table/tbody/tr[9]";
  const scalability = await stagehand.page.extract({
    instruction:
      "Extract the scalability comment in the table for Gemini (Google)",
    schema: z.object({
      scalability: z.string(),
    }),
    modelName,
    useTextExtract,
    selector: selector,
  });

  await stagehand.close();
  const scalabilityComment = scalability.scalability;

  // scalabilityCommentWeShouldNotGet matches a scalability comment in the table,
  // but since we are using targeted_extract here,
  // and passing in a selector that does NOT contain the scalabilityCommentWeShouldNotGet,
  // the LLM should have no visibility into scalabilityCommentWeShouldNotGet if
  // targeted_extract is performing correctly
  const scalabilityCommentWeShouldNotGet = {
    scalability: "Scalable architecture with API access",
  };

  const commentMatches =
    scalabilityComment == scalabilityCommentWeShouldNotGet.scalability;

  if (commentMatches) {
    logger.error({
      message:
        "extracted scalability comment matches the scalability comment that we SHOULD NOT get",
      level: 0,
      auxiliary: {
        expected: {
          value: scalabilityCommentWeShouldNotGet.scalability,
          type: "string",
        },
        actual: {
          value: scalabilityComment,
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error:
        "scalability comment matches the scalability comment that we SHOULD NOT get",
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  }

  return {
    _success: true,
    logs: logger.getLogs(),
    debugUrl,
    sessionUrl,
  };
};
