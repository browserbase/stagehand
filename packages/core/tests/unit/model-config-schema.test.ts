import { describe, expect, it } from "vitest";

import { Api } from "../../lib/v3/types/public/index.js";

describe("ModelConfigObjectSchema", () => {
  it("accepts Bedrock bearer token auth", () => {
    const result = Api.ModelConfigObjectSchema.safeParse({
      modelName: "bedrock/us.amazon.nova-pro-v1:0",
      apiKey: "bedrock-short-term-api-key",
      providerOptions: {
        region: "us-east-1",
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts Bedrock AWS credential auth", () => {
    const result = Api.ModelConfigObjectSchema.safeParse({
      modelName: "bedrock/us.amazon.nova-pro-v1:0",
      providerOptions: {
        region: "us-east-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "secret",
        sessionToken: "session-token",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects Bedrock config without region", () => {
    const result = Api.ModelConfigObjectSchema.safeParse({
      modelName: "bedrock/us.amazon.nova-pro-v1:0",
      apiKey: "bedrock-short-term-api-key",
    });

    expect(result.success).toBe(false);
  });

  it("rejects partial Bedrock AWS credentials", () => {
    const result = Api.ModelConfigObjectSchema.safeParse({
      modelName: "bedrock/us.amazon.nova-pro-v1:0",
      providerOptions: {
        region: "us-east-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects Bedrock configs that provide both auth modes", () => {
    const result = Api.ModelConfigObjectSchema.safeParse({
      modelName: "bedrock/us.amazon.nova-pro-v1:0",
      apiKey: "bedrock-short-term-api-key",
      providerOptions: {
        region: "us-east-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "secret",
      },
    });

    expect(result.success).toBe(false);
  });

  it("accepts Vertex provider options", () => {
    const result = Api.ModelConfigObjectSchema.safeParse({
      modelName: "vertex_ai/gemini-2.5-pro",
      providerOptions: {
        project: "test-project",
        location: "us-central1",
        googleAuthOptions: {
          credentials: {
            client_email: "test@example.com",
          },
        },
      },
    });

    expect(result.success).toBe(true);
  });
});

describe("SessionStartRequestSchema", () => {
  it("rejects Bedrock session start without region", () => {
    const result = Api.SessionStartRequestSchema.safeParse({
      modelName: "bedrock/us.amazon.nova-pro-v1:0",
      modelClientOptions: {
        apiKey: "bedrock-short-term-api-key",
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects Bedrock session start that mixes auth modes", () => {
    const result = Api.SessionStartRequestSchema.safeParse({
      modelName: "bedrock/us.amazon.nova-pro-v1:0",
      modelClientOptions: {
        apiKey: "bedrock-short-term-api-key",
        providerOptions: {
          region: "us-east-1",
          accessKeyId: "AKIAIOSFODNN7EXAMPLE",
          secretAccessKey: "secret",
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("accepts generic model client options without provider-specific model context", () => {
    const result = Api.ModelClientOptionsSchema.safeParse({
      apiKey: "some-api-key",
      baseURL: "https://example.com/v1",
      headers: {
        "X-Test-Header": "value",
      },
    });

    expect(result.success).toBe(true);
  });
});
