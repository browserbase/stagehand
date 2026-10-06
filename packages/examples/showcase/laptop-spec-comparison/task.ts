import type { ShowcaseTask } from "../_harness/task.ts";
import type { schema } from "./workflow.ts";

export const task: ShowcaseTask<typeof schema> = {
  proxies: true,
  startUrl: "https://www.staples.com/laptops%2016gb%20ram/directory_laptops%2016gb%20ram",
  goal: 'Search Staples for "laptops 16gb ram". Open the first three laptops in the results that are not sponsored and, for each, report the name, current price in USD, processor, RAM in GB, storage in GB, screen size in inches, weight in pounds (null if not listed) and the product page URL.',
  check: ({ laptops }) =>
    laptops.length === 3 &&
    new Set(laptops.map((laptop) => laptop.url)).size === 3 &&
    laptops.every((laptop) => laptop.price > 0 && laptop.ramGb >= 16 && laptop.screenInches > 0),
};
