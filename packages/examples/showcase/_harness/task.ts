import type { Page, Stagehand } from "@browserbasehq/stagehand";
import type { z } from "zod/v4";

export type Workflow<Schema extends z.ZodType> = {
  schema: Schema;
  run(stagehand: Stagehand, page: Page): Promise<z.output<Schema>>;
};

// What the harness needs beyond the cookbook itself: the natural-language goal
// handed to the Playwright MCP baseline, and a success check applied to the
// output of both sides so that "success" means the same thing for each.
export type ShowcaseTask<Schema extends z.ZodType> = {
  startUrl: string;
  // Residential proxies, for sites that block datacenter traffic.
  proxies?: boolean;
  goal: string;
  check(output: z.output<Schema>): boolean;
};
