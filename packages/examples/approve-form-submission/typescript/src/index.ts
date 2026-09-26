import "dotenv/config";
import { openai } from "@ai-sdk/openai";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { generateText, stepCountIs, tool, type ModelMessage, type ToolApprovalResponse } from "ai";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { z } from "zod/v4";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const browserbaseApiKey = requireEnv("BROWSERBASE_API_KEY");
const openaiApiKey = requireEnv("OPENAI_API_KEY");

const browser = await browserbase.launch({
  apiKey: browserbaseApiKey,
});

try {
  const stagehand = await Stagehand.create({
    browser,
    model: { modelName: "openai/gpt-5.4-mini", apiKey: openaiApiKey },
  });
  try {
    const page = await browser.context.activePage();
    if (!page) throw new Error("No active page");
    await page.goto("https://httpbin.org/forms/post");

    const tools = {
      fillForm: tool({
        description: "Fill the test order form without submitting it.",
        inputSchema: z.object({
          customer: z.string(),
          email: z.string().email(),
          size: z.enum(["small", "medium", "large"]),
          comments: z.string(),
        }),
        execute: async ({ customer, email, size, comments }) => {
          const customerResult = await stagehand.act(
            "Type %customer% into the customer name field",
            {
              page,
              variables: { customer },
            },
          );
          if (!customerResult.data.success) throw new Error(customerResult.data.message);
          const emailResult = await stagehand.act("Type %email% into the email field", {
            page,
            variables: { email },
          });
          if (!emailResult.data.success) throw new Error(emailResult.data.message);
          const sizeResult = await stagehand.act(`Select the ${size} size`, { page });
          if (!sizeResult.data.success) throw new Error(sizeResult.data.message);
          const commentsResult = await stagehand.act("Type %comments% into the comments field", {
            page,
            variables: { comments },
          });
          if (!commentsResult.data.success) throw new Error(commentsResult.data.message);
          return { filled: true, customer, email, size, comments };
        },
      }),
      submitForm: tool({
        description: "Submit the filled test order form.",
        inputSchema: z.object({
          summary: z.string().describe("A short summary shown to the approver"),
        }),
        needsApproval: true,
        execute: async () => {
          const submitted = await stagehand.act("Click the Submit order button", { page });
          if (!submitted.data.success) throw new Error(submitted.data.message);
          await page.waitForLoadState("domcontentloaded");
          return { submitted: true, url: await page.url() };
        },
      }),
    };

    const messages: ModelMessage[] = [
      {
        role: "user",
        content:
          "Fill the form for Ada Lovelace, ada@example.com, medium size, with the comment 'Leave at reception', then submit it.",
      },
    ];

    let result = await generateText({
      model: openai(process.env.OPENAI_MODEL ?? "gpt-5.4"),
      instructions: "Use fillForm before submitForm. If submission is denied, do not retry it.",
      messages,
      tools,
      stopWhen: stepCountIs(8),
    });
    messages.push(...result.response.messages);

    const pending = result.content.filter((part) => part.type === "tool-approval-request");
    if (pending.length !== 1)
      throw new Error(`Expected one submission approval, got ${pending.length}`);

    for (const request of pending) {
      console.log("Pending browser action:", request.toolCall.input);
    }

    const prompt = createInterface({ input: stdin, output: stdout });
    const answer = await prompt.question("Submit this form? [y/N] ");
    prompt.close();
    const approved = answer.trim().toLowerCase() === "y";

    const approvals: ToolApprovalResponse[] = pending.map((request) => ({
      type: "tool-approval-response",
      approvalId: request.approvalId,
      approved,
      reason: approved ? "Approved in the CLI" : "Rejected in the CLI",
    }));
    messages.push({ role: "tool", content: approvals });

    result = await generateText({
      model: openai(process.env.OPENAI_MODEL ?? "gpt-5.4"),
      instructions: "If submission was denied, do not request it again.",
      messages,
      tools,
      stopWhen: stepCountIs(5),
    });

    console.log(result.text);
  } finally {
    await stagehand.close();
  }
} finally {
  await browser.close();
}
