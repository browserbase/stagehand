import { z } from "zod/v3";

export const operatorResponseSchema = z.object({
  reasoning: z
    .string()
    .describe(
      "The reasoning for the step taken. If this step's method is `close`, the goal was to extract data, and the task was successful, state the data that was extracted.",
    ),
  method: z.enum([
    "act",
    "extract",
    "goto",
    "close",
    "wait",
    "navback",
    "refresh",
  ])
    .describe(`The action to perform on the page based off of the goal and the current state of the page.
      goto: Navigate to a specific URL.
      act: Perform an action on the page.  
      extract: Extract data from the page.
      close: The task is complete, close the browser.
      wait: Wait for a period of time.
      navback: Navigate back to the previous page. Do not navigate back if you are already on the first page.
      refresh: Refresh the page.`),
  parameters: z
    .string()
    .describe(
      `The parameter for the action. Only pass in a parameter for the following methods:
        - act: The action to perform. e.g. "click on the submit button" or "type [email] into the email input field and press enter"
        - extract: The data to extract. e.g. "the title of the article". If you want to extract all of the text on the page, leave this undefined.
        - wait: The amount of time to wait in milliseconds.
        - goto: The URL to navigate to. e.g. "https://www.google.com"
        The other methods do not require a parameter.`,
    )
    .nullable(),
  taskComplete: z
    .boolean()
    .describe(
      "Whether the task is complete. If true, the task is complete and no more steps are needed. If you chose to close the task because the goal is not achievable, set this to false.",
    ),
});

export type OperatorResponse = z.infer<typeof operatorResponseSchema>;

export const operatorSummarySchema = z.object({
  answer: z.string().describe("The final answer to the original instruction."),
});

export type OperatorSummary = z.infer<typeof operatorSummarySchema>;
