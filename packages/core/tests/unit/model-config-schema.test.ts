import { describe, expect, it } from "vitest";

import { Api } from "../../lib/v3/types/public/index.js";

describe("ModelClientOptionsSchema", () => {
  it("accepts Bedrock bearer token auth", () => {
    const result = Api.ModelClientOptionsSchema.safeParse({
      apiKey: "bedrock-short-term-api-key",
      providerOptions: {
        region: "us-east-1",
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts Bedrock AWS credential auth", () => {
    const result = Api.ModelClientOptionsSchema.safeParse({
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
    const result = Api.ModelClientOptionsSchema.safeParse({
      apiKey: "bedrock-short-term-api-key",
    });

    expect(result.success).toBe(false);
  });

  it("rejects partial Bedrock AWS credentials", () => {
    const result = Api.ModelClientOptionsSchema.safeParse({
      providerOptions: {
        region: "us-east-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects Bedrock configs that provide both auth modes", () => {
    const result = Api.ModelClientOptionsSchema.safeParse({
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
    const result = Api.ModelClientOptionsSchema.safeParse({
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
