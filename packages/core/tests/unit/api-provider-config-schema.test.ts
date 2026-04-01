import { describe, expect, it } from "vitest";

import { Api } from "../../lib/v3/types/public/index.js";

const bedrockModelName = "bedrock/anthropic.claude-3-7-sonnet-20250219-v1:0";

describe("API provider config schemas", () => {
  it("rejects Bedrock session start payloads without a region", () => {
    const result = Api.SessionStartRequestSchema.safeParse({
      modelName: bedrockModelName,
      modelClientOptions: {
        providerConfig: {
          provider: "bedrock",
          options: {},
        },
      },
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      "region is required for Bedrock provider",
    );
  });

  it("rejects Bedrock model configs with only one AWS credential", () => {
    const result = Api.ActRequestSchema.safeParse({
      input: "click the submit button",
      options: {
        model: {
          modelName: bedrockModelName,
          providerConfig: {
            provider: "bedrock",
            options: {
              region: "us-east-1",
              accessKeyId: "AKIATEST",
            },
          },
        },
      },
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      "accessKeyId and secretAccessKey must both be provided together",
    );
  });

  it("rejects Bedrock session tokens without accessKeyId and secretAccessKey", () => {
    const result = Api.SessionStartRequestSchema.safeParse({
      modelName: bedrockModelName,
      modelClientOptions: {
        providerConfig: {
          provider: "bedrock",
          options: {
            region: "us-east-1",
            sessionToken: "session-token",
          },
        },
      },
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      "sessionToken requires accessKeyId and secretAccessKey",
    );
  });
});
