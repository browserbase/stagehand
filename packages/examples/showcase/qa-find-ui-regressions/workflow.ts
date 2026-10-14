import type { Page, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

// saucedemo.com publishes these accounts; two of them ship deliberate bugs.
const USERS = ["standard_user", "problem_user", "error_user"];
const PASSWORD = "secret_sauce";
const ITEMS = ["Sauce Labs Backpack", "Sauce Labs Bike Light"];

const check = z.object({ name: z.string(), passed: z.boolean() });

export const schema = z.object({
  users: z.array(
    z.object({
      username: z.string(),
      checks: z.array(check),
      issues: z.array(z.string()).describe("What went wrong, in plain words"),
    }),
  ),
});

async function testCheckout(stagehand: Stagehand, page: Page, username: string) {
  const checks: z.output<typeof check>[] = [];
  const issues: string[] = [];
  const verify = async (name: string, question: string) => {
    const { data } = await stagehand.extract(
      question,
      z.object({ passed: z.boolean(), observed: z.string() }),
      { page },
    );
    checks.push({ name, passed: data.passed });
    if (!data.passed) issues.push(`${name}: ${data.observed}`);
    return data.passed;
  };

  // The cart lives in localStorage, so every account starts from a clean slate.
  await page.goto("https://www.saucedemo.com");
  await page.evaluate("localStorage.clear()");
  await page.goto("https://www.saucedemo.com");

  // Variables keep the password out of the prompt sent to the model.
  await stagehand.act("Type %username% into the Username field", {
    page,
    variables: { username },
  });
  await stagehand.act("Type %password% into the Password field", {
    page,
    variables: { password: PASSWORD },
  });
  await stagehand.act("Click Login", { page });

  for (const item of ITEMS) await stagehand.act(`Click "Add to cart" for "${item}"`, { page });
  if (!(await verify("both items in cart", `Does the cart badge show ${ITEMS.length} items?`))) {
    return { username, checks, issues };
  }

  await stagehand.act("Open the cart", { page });
  await stagehand.act("Click Checkout", { page });
  await stagehand.act('Type "Ada" into First Name', { page });
  await stagehand.act('Type "Lovelace" into Last Name', { page });
  await stagehand.act('Type "94103" into Zip/Postal Code', { page });
  await stagehand.act("Click Continue", { page });
  if (
    !(await verify(
      "checkout info accepted",
      "Is this the checkout overview page, with no error message about the form?",
    ))
  ) {
    return { username, checks, issues };
  }

  await stagehand.act("Click Finish", { page });
  await verify(
    "order confirmed",
    'Does the page confirm the order with "Thank you for your order"?',
  );
  return { username, checks, issues };
}

export async function run(stagehand: Stagehand, page: Page): Promise<z.output<typeof schema>> {
  const users = [];
  // The same test, unchanged, against every variant of the app.
  for (const username of USERS) users.push(await testCheckout(stagehand, page, username));
  return { users };
}
