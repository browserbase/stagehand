import { EvalFunction } from "../types/evals";
import { z } from "zod";

export const combination_sauce: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://www.saucedemo.com/");

    const { usernames, password } = await v3.extract(
      "extract the accepted usernames and the password for login",
      z.object({
        usernames: z.array(z.string()).describe("the accepted usernames"),
        password: z.string().describe("the password for login"),
      }),
    );

    await v3.act(`enter username 'standard_user'`);

    await v3.act(`enter password '${password}'`);

    await v3.act("click on 'login'");

    const observations = await v3.observe("find all the 'add to cart' buttons");

    const url = page.url();

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
