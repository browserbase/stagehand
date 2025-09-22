import { EvalFunction } from "@/lib/v3/types/evals";
import { z } from "zod/v3";

export const combination_sauce: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://www.saucedemo.com/");

    const { usernames, password } = await v3.extract({
      instruction: "extract the accepted usernames and the password for login",
      schema: z.object({
        usernames: z.array(z.string()).describe("the accepted usernames"),
        password: z.string().describe("the password for login"),
      }),
    });

    await v3.act({ instruction: `enter username 'standard_user'` });

    await v3.act({ instruction: `enter password '${password}'` });

    await v3.act({ instruction: "click on 'login'" });

    const observations = await v3.observe({
      instruction: "find all the 'add to cart' buttons",
    });

    const url = await page.url();

    const usernamesCheck = usernames.length === 6;
    const urlCheck = url === "https://www.saucedemo.com/inventory.html";
    const observationsCheck = observations.length === 6;

    return {
      _success: usernamesCheck && urlCheck && observationsCheck,
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
    await v3.close();
  }
};
