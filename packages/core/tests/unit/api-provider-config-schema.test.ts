import { describe, expect, it } from "vitest";

import { Api } from "../../lib/v3/types/public/index.js";

const bedrockModelName = "bedrock/anthropic.claude-3-7-sonnet-20250219-v1:0";

describe("API provider config schemas", () => {
  it("rejects Bedrock session start payloads without a region", () => {
    const result = Api.SessionStartRequestSchema.safeParse({
      modelName: bedrockModelName,
      modelClientOptions: {
        providerOptions: {},
      },
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      "Bedrock configs require providerOptions.region.",
    );
  });

  it("rejects Bedrock model configs with only one AWS credential", () => {
    const result = Api.ActRequestSchema.safeParse({
      input: "click the submit button",
      options: {
        model: {
          modelName: bedrockModelName,
          providerOptions: {
            region: "us-east-1",
            accessKeyId: "AKIATEST",
          },
        },
      },
    });

    expect(result.success).toBe(false);
    const issues = JSON.stringify(result.error?.issues);
    expect(issues).toContain("providerOptions");
    expect(issues).toContain("secretAccessKey");
  });

  it("rejects Bedrock session tokens without accessKeyId and secretAccessKey", () => {
    const result = Api.SessionStartRequestSchema.safeParse({
      modelName: bedrockModelName,
      modelClientOptions: {
        providerOptions: {
          region: "us-east-1",
          sessionToken: "session-token",
        },
      },
    });

    expect(result.success).toBe(false);
    const issues = JSON.stringify(result.error?.issues);
    expect(issues).toContain("sessionToken");
    expect(issues).toContain("accessKeyId");
    expect(issues).toContain("secretAccessKey");
  });
});
