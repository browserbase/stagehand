import { describe, expect, it } from "vitest";

import { Api } from "../../lib/v3/types/public/index.js";

const bedrockModelName = "bedrock/us.amazon.nova-lite-v1:0";
const vertexModelName = "vertex/gemini-2.5-pro";

describe("API providerConfig schemas", () => {
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
      "Bedrock configs require providerConfig.options.region.",
    );
    expect(result.error?.issues[0]?.path).toEqual([
      "modelClientOptions",
      "providerConfig",
      "options",
      "region",
    ]);
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
    const issues = JSON.stringify(result.error?.issues);
    expect(issues).toContain("providerConfig");
    expect(issues).toContain("secretAccessKey");
  });

  it("rejects mismatched providerConfig providers", () => {
    const result = Api.ActRequestSchema.safeParse({
      input: "click the submit button",
      options: {
        model: {
          modelName: "openai/gpt-4.1-mini",
          providerConfig: {
            provider: "bedrock",
            options: {
              region: "us-east-1",
            },
          },
        },
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'providerConfig.provider "bedrock" must match the model provider "openai"',
    );
  });

  it("rejects unsupported Bedrock providerConfig options", () => {
    const result = Api.SessionStartRequestSchema.safeParse({
      modelName: bedrockModelName,
      modelClientOptions: {
        providerConfig: {
          provider: "bedrock",
          options: {
            region: "us-east-1",
            fetch: "nope",
          },
        },
      },
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      "Bedrock configs do not support modelClientOptions.providerConfig.options.fetch.",
    );
  });

  it("rejects unsupported Vertex googleAuthOptions fields", () => {
    const result = Api.SessionStartRequestSchema.safeParse({
      modelName: vertexModelName,
      modelClientOptions: {
        providerConfig: {
          provider: "vertex",
          options: {
            project: "vertex-project",
            location: "us-central1",
            googleAuthOptions: {
              credentials: {
                client_email: "vertex@example.com",
                private_key: "private-key",
              },
              authClient: {
                nope: true,
              },
            },
          },
        },
      },
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      "Vertex configs do not support modelClientOptions.providerConfig.options.googleAuthOptions.authClient.",
    );
  });

  it("accepts string-form navigate models", () => {
    const result = Api.NavigateRequestSchema.safeParse({
      url: "https://example.com",
      options: {
        model: "openai/gpt-5-nano",
      },
    });

    expect(result.success).toBe(true);
  });
});
