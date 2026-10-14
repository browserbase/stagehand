import type { ShowcaseTask } from "../_harness/task.ts";
import type { schema } from "./workflow.ts";

export const task: ShowcaseTask<typeof schema> = {
  startUrl: "https://job-boards.greenhouse.io/figma",
  goal: "Visit these job boards: https://job-boards.greenhouse.io/figma, https://job-boards.greenhouse.io/vercel, https://jobs.ashbyhq.com/notion, https://jobs.ashbyhq.com/ramp and https://jobs.lever.co/palantir. From each, collect every software engineering role that can be done remotely, with the company, the ATS (Greenhouse, Ashby or Lever), title, team (null if not shown), location and the absolute URL of the posting.",
  check: ({ roles }) =>
    roles.length > 0 &&
    new Set(roles.map((found) => found.ats)).size >= 2 &&
    roles.every((found) => found.url.startsWith("https://")),
};
