/**
 * This example shows how to run Stagehand with Amazon Bedrock using
 * a short-term Bedrock API key.
 *
 * Required env vars:
 * - AWS_REGION
 * - BEDROCK_API_KEY
 *
 * Optional env vars:
 * - BEDROCK_MODEL_ID (defaults to amazon.nova-pro-v1:0)
 *
 * Example command:
 * AWS_REGION=us-east-1 BEDROCK_API_KEY=... pnpm --filter @browserbasehq/stagehand example -- bedrock_api_key
 */
import { Stagehand } from "../lib/v3/index.js";
import { z } from "zod";

const region = process.env.AWS_REGION;
const apiKey = process.env.BEDROCK_API_KEY;
const modelId = process.env.BEDROCK_MODEL_ID ?? "amazon.nova-pro-v1:0";
const modelName = `bedrock/${modelId}`;

if (!region) {
  throw new Error("Set AWS_REGION before running the Bedrock API key example.");
}

if (!apiKey) {
  throw new Error(
    "Set BEDROCK_API_KEY before running the Bedrock API key example.",
  );
}

async function main() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
    model: {
      modelName,
      apiKey,
      providerOptions: {
        region,
      },
    },
  });

  try {
    await stagehand.init();

    const page = stagehand.context.pages()[0];
    await page.goto("https://example.com");

    const extraction = await stagehand.extract(
      "Extract the page heading and the visible link text.",
      z.object({
        heading: z.string(),
        linkText: z.string(),
      }),
    );

    console.log(
      JSON.stringify(
        {
          authMode: "bedrock-api-key",
          modelName,
          region,
          extraction,
        },
        null,
        2,
      ),
    );
  } finally {
    await stagehand.close();
  }
}

void main();
