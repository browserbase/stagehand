/**
 * This example shows how to use observe({ variables }) to plan a sensitive
 * login flow, validate the returned placeholder actions, and then execute them
 * with act().
 *
 * observe() returns %variableName% placeholders in action arguments. That lets
 * you review the planned actions before any real secret values are used.
 */
import { Action, Stagehand } from "../lib/v3/index.js";
import chalk from "chalk";

const variables = {
  username: "test@browserbase.com",
  password: "stagehand=goated",
};

const loginInstruction = [
  "Fill the login form using the available variables.",
  "Use %username% for the email field.",
  "Use %password% for the password field.",
  "Include the field name in each action description.",
].join(" ");

function findValidatedAction(
  observed: Action[],
  placeholder: string,
  keywords: string[],
): Action {
  const matches = observed.filter((action) => {
    const description = action.description.toLowerCase();
    return (
      action.arguments?.includes(placeholder) === true &&
      keywords.some((keyword) => description.includes(keyword))
    );
  });

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one safe action for ${placeholder}, found ${matches.length}`,
    );
  }

  return matches[0];
}

async function observeVariablesLogin() {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    verbose: 1,
  });

  await stagehand.init();

  try {
    const page = stagehand.context.pages()[0];

    await page.goto("https://v0-modern-login-flow.vercel.app/", {
      waitUntil: "networkidle",
      timeoutMs: 30000,
    });

    const observed = await stagehand.observe(loginInstruction, {
      variables,
    });

    console.log(
      `${chalk.green("Observe:")} Placeholder actions found:\n${observed
        .map(
          (action) =>
            `${chalk.yellow(action.description)} -> ${chalk.blue(action.arguments?.join(", ") || "no arguments")}`,
        )
        .join("\n")}`,
    );

    const emailAction = findValidatedAction(observed, "%username%", ["email"]);
    const passwordAction = findValidatedAction(observed, "%password%", [
      "password",
    ]);

    console.log(
      `\n${chalk.green("Validated:")} Safe actions to execute:\n${[
        emailAction,
        passwordAction,
      ]
        .map(
          (action) =>
            `${chalk.yellow(action.description)} -> ${chalk.blue(action.arguments?.[0] || "no value")}`,
        )
        .join("\n")}`,
    );

    await stagehand.act(emailAction, { variables });
    await stagehand.act(passwordAction, { variables });

    const [submitButton] = await stagehand.observe("find the sign in button");

    if (!submitButton) {
      throw new Error("Could not find the sign in button");
    }

    await stagehand.act(submitButton);
    console.log(
      chalk.green(
        "\nSubmitted login form. Waiting 10 seconds before closing...",
      ),
    );
    await page.waitForTimeout(10000);
  } finally {
    await stagehand.close();
  }
}

(async () => {
  await observeVariablesLogin();
})();
