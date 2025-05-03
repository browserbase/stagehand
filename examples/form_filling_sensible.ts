/**
 * This example shows you how to use observe() to get a cacheable Playwright action as JSON, then pass that JSON to act() to perform the action.
 *
 * In this specific example, we use observe() to get multiple actions, then iterate through each action to fill the form with sensitive data at lightning speed.
 */
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/stagehand.config";
import chalk from "chalk";

async function formFillingSensible() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
  });
  await stagehand.init();
  const page = stagehand.page;

  // Block manifest worker to prevent PWA installation popup.
  // This is necessary because the website prompts the user to install the PWA and prevents form filling.
  await page.route("**/manifest.json", (route) => route.abort());

  // Go to the website and wait for it to load
  await page.goto("https://file.1040.com/estimate/", {
    waitUntil: "networkidle",
    timeout: 30000,
  });

  // Observe the form fields with suggested actions
  const observed = await page.observe(
    "fill all the form fields in the page with mock data. In the description include the field name",
  );

  // Uncomment the following snippet to see the stagehand candidate suggestions (initial)
  console.log(
    `${chalk.green("Observe:")} Form fields found:\n${observed
      .map((r) => `${chalk.yellow(r.description)} -> ${chalk.gray(r.selector)}`)
      .join("\n")}`,
  );

  // Create a mapping of 1+ keywords in the form fields to standardize field names
  const mapping = (description: string): string | null => {
    const keywords: { [key: string]: string[] } = {
      age: ["old"],
      dependentsUnder17: ["under age 17", "child", "minor"],
      dependents17to23: ["17-23", "school", "student"],
      wages: ["wages", "W-2 Box 1"],
      federalTax: ["federal tax", "Box 2"],
      stateTax: ["state tax", "Box 17"],
    };

    for (const [key, terms] of Object.entries(keywords)) {
      if (terms.some((term) => description.toLowerCase().includes(term))) {
        return key;
      }
    }
    return null;
  };

  // Fill the form fields with sensible data. This data will only be used in your session and not be shared with LLM providers/external APIs.
  const userInputs: { [key: string]: string } = {
    age: "26",
    dependentsUnder17: "1",
    wages: "54321",
    federalTax: "8345",
    stateTax: "2222",
  };

  const updatedFields = observed.map((candidate) => {
    const key = mapping(candidate.description);
    if (key && userInputs[key]) {
      candidate.arguments = [userInputs[key]];
    }
    return candidate;
  });
  // List of sensible-data candidates
  console.log(
    `\n${chalk.green("Sensible Data form inputs:")} Form fields to be filled:\n${updatedFields
      .map(
        (r) =>
          `${chalk.yellow(r.description)} -> ${chalk.blue(r.arguments?.[0] || "no value")}`,
      )
      .join("\n")}`,
  );

  // Fill all the form fields with the sensible candidates
  for (const candidate of updatedFields) {
    await page.act(candidate);
  }
}

(async () => {
  await formFillingSensible();
})();
