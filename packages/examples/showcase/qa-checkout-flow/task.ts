import type { ShowcaseTask } from "../_harness/task.ts";
import type { schema } from "./workflow.ts";

export const task: ShowcaseTask<typeof schema> = {
  startUrl: "https://www.saucedemo.com",
  goal: 'On saucedemo.com, log in as standard_user with password secret_sauce, add "Sauce Labs Backpack" and "Sauce Labs Bike Light" to the cart and check out as Ada Lovelace, ZIP 94103. From the checkout overview report each item and price, the subtotal, tax and total; finish the order and report the confirmation heading. Also report these checks as pass/fail: cart has both items, subtotal equals item prices, total equals subtotal plus tax, order confirmed.',
  check: ({ checks }) => checks.length === 4 && checks.every((check) => check.passed),
};
