import "dotenv/config";
import OpenAI from "openai";
import type { ResponseInput } from "openai/resources/responses/responses";
import { z } from "zod/v4";
import type {
  LLMGenerateParams,
  LLMGenerateResult,
  LLMMessageContentBlock,
} from "@browserbasehq/stagehand-protocol/types";
import { localBrowser, Stagehand } from "../src/index.js";

const { OPENAI_API_KEY } = process.env;
if (!OPENAI_API_KEY) throw new Error();

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});
const generationNames: string[] = [];

const browser = await localBrowser.launch({ headless: true });
const stagehand = await Stagehand.create({
  browser,
  model: {
    generate: generateWithOpenAI,
  },
});

const [page] = await browser.context.pages();
await page.goto("https://example.com");

const extractResult = await stagehand.extract(
  "Extract the page heading and description",
  z.object({
    heading: z.string(),
    description: z.string(),
  }),
);
const observeResult = await stagehand.observe(
  "Find the link that provides more information about Example Domain",
);
const actResult = await stagehand.act(
  "Click the link that provides more information about Example Domain",
);

console.log(
  JSON.stringify(
    {
      pageInfo: extractResult.data,
      actions: observeResult.data,
      actionResult: actResult.data,
      generationNames,
    },
    null,
    2,
  ),
);

if (observeResult.data.length === 0) {
  throw new Error("observe() returned no matching actions");
}
if (!actResult.data.success) {
  throw new Error(`act() failed: ${actResult.data.message}`);
}

await stagehand.close();
await browser.close();

async function generateWithOpenAI(params: LLMGenerateParams): Promise<LLMGenerateResult> {
  if (params.responseFormat?.type !== "json_schema") {
    throw new TypeError(
      "This example supports the structured generation used by act, extract, and observe",
    );
  }

  const schema = params.responseFormat.schema;
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    throw new TypeError("OpenAI structured output requires an object JSON Schema");
  }

  generationNames.push(params.responseFormat.name);
  const input: ResponseInput = params.messages.map((message) => ({
    role: message.role,
    content: messageText(message.content),
  }));
  const response = await openai.responses.create({
    model: "gpt-5.4-mini",
    instructions: params.systemPrompt,
    input,
    temperature: params.temperature,
    text: {
      format: {
        type: "json_schema",
        name: params.responseFormat.name,
        description: params.responseFormat.description,
        schema,
        strict: true,
      },
    },
  });

  if (!response.output_text) {
    throw new Error("OpenAI returned no output text");
  }

  return {
    role: "assistant",
    content: { type: "text", text: response.output_text },
    outputFormat: "json_schema",
    structuredContent: z.json().parse(JSON.parse(response.output_text)),
    ...(response.status ? { stopReason: response.status } : {}),
    ...(response.usage
      ? {
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            totalTokens: response.usage.total_tokens,
            reasoningTokens: response.usage.output_tokens_details.reasoning_tokens,
            cachedInputTokens: response.usage.input_tokens_details.cached_tokens,
          },
        }
      : {}),
  };
}

function messageText(content: LLMMessageContentBlock | LLMMessageContentBlock[]): string {
  const blocks = Array.isArray(content) ? content : [content];
  return blocks
    .map((block) => {
      if (block.type !== "text") {
        throw new TypeError(`This example does not support ${block.type} message blocks`);
      }
      return block.text;
    })
    .join("\n");
}
