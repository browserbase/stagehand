/**
 * This example shows how to run Stagehand with Amazon Bedrock using
 * AWS credentials.
 *
 * Required env vars:
 * - AWS_REGION
 * - AWS_ACCESS_KEY_ID
 * - AWS_SECRET_ACCESS_KEY
 *
 * Optional env vars:
 * - AWS_SESSION_TOKEN
 * - BEDROCK_MODEL_ID (defaults to amazon.nova-pro-v1:0)
 *
 * Example command:
 * AWS_REGION=us-east-1 AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... pnpm --filter @browserbasehq/stagehand example -- bedrock_aws_credentials
 */
import { Stagehand } from "../lib/v3/index.js";
import { z } from "zod";

const region = process.env.AWS_REGION;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const sessionToken = process.env.AWS_SESSION_TOKEN;
const modelId = process.env.BEDROCK_MODEL_ID ?? "amazon.nova-pro-v1:0";
const modelName = `bedrock/${modelId}`;

if (!region) {
  throw new Error(
    "Set AWS_REGION before running the Bedrock AWS credentials example.",
  );
}

if (!accessKeyId || !secretAccessKey) {
  throw new Error(
    "Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY before running the Bedrock AWS credentials example.",
  );
}

async function main() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
    model: {
      modelName,
      providerOptions: {
        region,
        accessKeyId,
        secretAccessKey,
        ...(sessionToken ? { sessionToken } : {}),
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
          authMode: "aws-credentials",
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
