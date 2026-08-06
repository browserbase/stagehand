import { createStagehandMcpBinding } from "./agent.js";
import type { Tool } from "ai";

process.env.STAGEHAND_BROWSER ??= "local";

const { client, tools } = await createStagehandMcpBinding();
try {
  const names = Object.keys(tools);
  if (names.length !== 1 || names[0] !== "code_execute") {
    throw new Error(`Expected one code_execute tool, got ${names.join(", ")}`);
  }

  const tool = tools.code_execute as Tool<{ code: string }, unknown>;
  if (typeof tool?.execute !== "function") {
    throw new Error("Vercel AI SDK did not expose code_execute as executable.");
  }
  const description =
    typeof tool.description === "function" ? tool.description({ context: {} }) : tool.description;
  if (!description?.includes("Stagehand V4 code-mode syntax")) {
    throw new Error("code_execute did not include the canonical Stagehand guidance.");
  }

  const first = await tool.execute(
    {
      code: `
        await page.goto("https://example.com", { waitUntil: "load" });
        await context.newPage();
        await context.setActivePage(page);
        return { title: await page.title(), pages: (await context.pages()).length };
      `,
    },
    { context: {}, messages: [], toolCallId: "vercel-smoke-1" },
  );
  const second = await tool.execute(
    {
      code: `return { title: await page.title(), pages: (await context.pages()).length };`,
    },
    { context: {}, messages: [], toolCallId: "vercel-smoke-2" },
  );

  const firstText = JSON.stringify(first);
  const secondText = JSON.stringify(second);
  if (!firstText.includes("Example Domain") || !secondText.includes('"pages":2')) {
    throw new Error(`Expected browser state to persist across calls: ${firstText} ${secondText}`);
  }

  process.stdout.write(
    `${JSON.stringify({ status: "PASS", tools: names, statePersisted: true })}\n`,
  );
} finally {
  await client.close();
}
