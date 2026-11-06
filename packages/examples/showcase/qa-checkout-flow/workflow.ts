import type { Page, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

// Public demo credentials published on saucedemo.com itself.
const CREDENTIALS = { username: "standard_user", password: "secret_sauce" };
const ITEMS = ["Sauce Labs Backpack", "Sauce Labs Bike Light"];

const overview = z.object({
  items: z.array(z.object({ name: z.string(), price: z.number() })),
  subtotal: z.number(),
  tax: z.number(),
  total: z.number(),
});

export const schema = overview.extend({
  confirmation: z.string(),
  checks: z.array(z.object({ name: z.string(), passed: z.boolean() })),
});

const cents = (value: number) => Math.round(value * 100);

export async function run(stagehand: Stagehand, page: Page): Promise<z.output<typeof schema>> {
  await page.goto("https://www.saucedemo.com");

  // Variables keep the password out of the prompt sent to the model.
  await stagehand.act("Type %username% into the Username field", {
    page,
    variables: { username: CREDENTIALS.username },
  });
  await stagehand.act("Type %password% into the Password field", {
    page,
    variables: { password: CREDENTIALS.password },
  });
  await stagehand.act("Click Login", { page });

  for (const item of ITEMS) await stagehand.act(`Click "Add to cart" for "${item}"`, { page });
  await stagehand.act("Open the cart", { page });
  await stagehand.act("Click Checkout", { page });
  // One act performs one action, so each field gets its own instruction.
  await stagehand.act('Type "Ada" into First Name', { page });
  await stagehand.act('Type "Lovelace" into Last Name', { page });
  await stagehand.act('Type "94103" into Zip/Postal Code', { page });
  await stagehand.act("Click Continue", { page });

  const { data: summary } = await stagehand.extract(
    "The items, subtotal, tax and total on the checkout overview",
    overview,
    { page },
  );
  await stagehand.act("Click Finish", { page });
  const { data: done } = await stagehand.extract(
    "The order confirmation heading",
    z.object({ confirmation: z.string() }),
    { page },
  );

  const itemSum = summary.items.reduce((sum, item) => sum + cents(item.price), 0);
  const checks = [
    { name: "cart has both items", passed: summary.items.length === ITEMS.length },
    { name: "subtotal equals item prices", passed: itemSum === cents(summary.subtotal) },
    {
      name: "total equals subtotal plus tax",
      passed: cents(summary.subtotal) + cents(summary.tax) === cents(summary.total),
    },
    { name: "order confirmed", passed: /thank you/i.test(done.confirmation) },
  ];
  return { ...summary, ...done, checks };
}
