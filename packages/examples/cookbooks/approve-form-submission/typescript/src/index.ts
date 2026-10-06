import "dotenv/config";
import { SubmissionGuard } from "./approval.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

async function main() {
  const browserbaseApiKey = requireEnv("BROWSERBASE_API_KEY");
  const openaiApiKey = requireEnv("OPENAI_API_KEY");
  const agentModel = openai("gpt-5.6-sol");

  const browser = await browserbase.launch({
    apiKey: browserbaseApiKey,
    timeout: 300,
  });

  try {
    console.log(`Session: https://www.browserbase.com/sessions/${browser.sessionId}`);
    const stagehand = await Stagehand.create({
      browser,
      model: { modelName: "openai/gpt-5.6-sol", apiKey: openaiApiKey },
    });
    try {
      const page = await browser.context.activePage();
      if (!page) throw new Error("No active page");
      await page.goto("https://httpbin.org/forms/post");

      const guard = new SubmissionGuard();
      const readForm = async () => ({
        customer: await page.locator('input[name="custname"]').inputValue(),
        email: await page.locator('input[name="custemail"]').inputValue(),
        size: await page.locator('input[name="size"]:checked').inputValue(),
        comments: await page.locator('textarea[name="comments"]').inputValue(),
      });
      let filledValues: Awaited<ReturnType<typeof readForm>> | undefined;
      let approvalId: string | undefined;
      await mkdir("out", { recursive: true });
      const receipt = async (status: string) => {
        await writeFile(
          "out/approval.json.tmp",
          `${JSON.stringify({ sessionId: browser.sessionId, approvalId, status, values: filledValues }, null, 2)}\n`,
          { mode: 0o600 },
        );
        await rename("out/approval.json.tmp", "out/approval.json");
      };
      const tools = {
        fillForm: tool({
          description: "Fill the test order form without submitting it.",
          inputSchema: z.object({
            customer: z.string(),
            email: z.email(),
            size: z.enum(["small", "medium", "large"]),
            comments: z.string(),
          }),
          execute: async ({ customer, email, size, comments }) => {
            guard.beforeFill();
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
            filledValues = await readForm();
            if (
              JSON.stringify(filledValues) !== JSON.stringify({ customer, email, size, comments })
            )
              throw new Error("Filled form does not match the requested values");
            guard.markFilled();
            return { filled: true, customer, email, size, comments };
          },
        }),
        submitForm: tool({
          description: "Submit the filled test order form.",
          inputSchema: z.object({
            summary: z.string().describe("A short summary shown to the approver"),
          }),
          execute: async () => {
            guard.claimSubmit();
            if (JSON.stringify(await readForm()) !== JSON.stringify(filledValues))
              throw new Error("Form changed after approval; submission blocked");
            await receipt("submission-attempted");
            const submitted = await stagehand.act("Click the Submit order button", { page });
            if (!submitted.data.success) throw new Error(submitted.data.message);
            await page.waitForLoadState("domcontentloaded");
            if (new URL(await page.url()).pathname !== "/post")
              throw new Error("Submission destination was not verified; inspect the session");
            await receipt("submitted");
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
        model: agentModel,
        instructions: "Use fillForm before submitForm. If submission is denied, do not retry it.",
        messages,
        tools,
        toolApproval: { submitForm: "user-approval" },
        abortSignal: AbortSignal.timeout(120_000),
        maxOutputTokens: 2000,
        maxRetries: 0,
        stopWhen: stepCountIs(8),
      });
      messages.push(...result.responseMessages);

      const pending = result.content.filter((part) => part.type === "tool-approval-request");
      if (pending.length !== 1 || pending[0].toolCall.toolName !== "submitForm")
        throw new Error(`Expected one submission approval, got ${pending.length}`);

      approvalId = pending[0].approvalId;
      console.log("Form values to submit:", filledValues);

      await receipt("pending");
      const prompt = createInterface({ input: stdin, output: stdout });
      let answer = "";
      try {
        answer = await prompt.question("Submit this form? [y/N] ", {
          signal: AbortSignal.timeout(60_000),
        });
      } finally {
        prompt.close();
      }
      const approved = answer.trim().toLowerCase() === "y";
      guard.decide(approved);
      await receipt(approved ? "approved" : "rejected");
      if (!approved) {
        console.log("Rejected: submit was not executed.");
        return;
      }

      const approvals: ToolApprovalResponse[] = pending.map((request) => ({
        type: "tool-approval-response",
        approvalId: request.approvalId,
        approved,
        reason: approved ? "Approved in the CLI" : "Rejected in the CLI",
      }));
      messages.push({ role: "tool", content: approvals });

      result = await generateText({
        model: agentModel,
        instructions: "If submission was denied, do not request it again.",
        messages,
        tools,
        toolApproval: { submitForm: "user-approval" },
        abortSignal: AbortSignal.timeout(120_000),
        maxOutputTokens: 2000,
        maxRetries: 0,
        stopWhen: stepCountIs(5),
      });

      const receiptData = JSON.parse(await readFile("out/approval.json", "utf8"));
      if (receiptData.status !== "submitted")
        throw new Error(
          "Approved action did not finish; inspect out/approval.json and the session before rerunning",
        );
      console.log(result.text);
    } finally {
      await stagehand.close();
    }
  } finally {
    await browser.close();
  }
}

await main();
