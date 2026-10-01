import type { ShowcaseTask } from "../_harness/task.ts";
import type { schema } from "./workflow.ts";

export const task: ShowcaseTask<typeof schema> = {
  startUrl: "https://www.saucedemo.com",
  goal: 'On saucedemo.com (password secret_sauce), run the same checkout test for each of standard_user, problem_user and error_user, starting each one with an empty cart: log in, add "Sauce Labs Backpack" and "Sauce Labs Bike Light" to the cart, open the cart, check out as Ada Lovelace with ZIP 94103, continue and finish. For each user, report pass/fail for these checks, stopping a user\'s test at the first failed check: "both items in cart", "checkout info accepted", "order confirmed"; and list any issues found, in plain words.',
  check: ({ users }) => {
    const byName = new Map(users.map((user) => [user.username, user]));
    const standard = byName.get("standard_user");
    const buggy = ["problem_user", "error_user"].map((name) => byName.get(name));
    return (
      users.length === 3 &&
      standard !== undefined &&
      standard.checks.length === 3 &&
      standard.checks.every((c) => c.passed) &&
      buggy.every((user) => user !== undefined && user.checks.some((c) => !c.passed))
    );
  },
};
