import type { Page, Stagehand } from "@browserbasehq/stagehand";
import type { z } from "zod/v4";

export type Workflow<Schema extends z.ZodType> = {
  schema: Schema;
  run(stagehand: Stagehand, page: Page): Promise<z.output<Schema>>;
};

export type ShowcaseTask<Schema extends z.ZodType> = {
  startUrl: string;
  proxies?: boolean;
  goal: string;
  check(output: z.output<Schema>): boolean;
};
