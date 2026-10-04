import type { ShowcaseTask } from "../_harness/task.ts";
import type { schema } from "./workflow.ts";

export const task: ShowcaseTask<typeof schema> = {
  startUrl: "https://www.ycombinator.com/companies/industry/developer-tools",
  goal: "From the Y Combinator directory's Developer Tools industry page, report the first 30 companies listed, each with its name, one-line description, location (null if not shown) and YC batch.",
  check: ({ companies }) =>
    companies.length === 30 &&
    new Set(companies.map((company) => company.name)).size === 30 &&
    companies.every((company) => company.batch.trim().length > 0),
};
