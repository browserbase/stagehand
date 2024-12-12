import { Stagehand } from "../lib";
import { z } from "zod";

async function example() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    debugDom: true,
    enableCaching: false,
    modelName: "claude-3-5-sonnet-latest",
    domSettleTimeoutMs: 10_000,
  });

  await stagehand.init();
  await stagehand.page.goto("https://www.mycmh.org/locations/");

  const result = await stagehand.extract({
    instruction:
      "extract a list of the health centers on this page with their name, phone number and full address",
    schema: z.object({
      health_centers: z.array(
        z.object({
          name: z.string(),
          phone_number: z.string(),
          address: z.string(),
        }),
      ),
    }),
  });

  console.log(
    `The healthcare centers are ${JSON.stringify(result.health_centers, null, 2)}`,
  );
}

(async () => {
  await example();
})();
