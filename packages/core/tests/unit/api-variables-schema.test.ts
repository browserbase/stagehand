import { describe, expect, it } from "vitest";
import { Api } from "../../lib/v3/types/public/index.js";

describe("API variable schemas", () => {
  it("accepts rich variables for act requests", () => {
    const result = Api.ActRequestSchema.safeParse({
      input: "type %username% into the email field",
      options: {
        variables: {
          username: {
            value: "john@example.com",
            description: "The login email",
          },
          rememberMe: true,
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts rich variables for observe requests", () => {
    const result = Api.ObserveRequestSchema.safeParse({
      instruction: "find the field where %username% should be entered",
      options: {
        variables: {
          username: {
            value: "john@example.com",
            description: "The login email",
          },
          rememberMe: true,
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it("preserves variables for agent execute requests", () => {
    const result = Api.AgentExecuteRequestSchema.safeParse({
      agentConfig: { mode: "dom" },
      executeOptions: {
        instruction: "fill the form with %username% and %password%",
        variables: {
          username: "john@example.com",
          password: {
            value: "secret-password",
            description: "The login password",
          },
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw result.error;
    expect(result.data.executeOptions.variables).toEqual({
      username: "john@example.com",
      password: {
        value: "secret-password",
        description: "The login password",
      },
    });
  });
});

describe("API model config schemas", () => {
  const vertexModel = {
    provider: "vertex",
    modelName: "vertex/gemini-2.5-flash",
    project: "test-gcp-project",
    location: "us-central1",
    googleAuthOptions: {
      apiKey: "vertex-express-key",
      credentials: {
        audience:
          "//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/pool/providers/provider",
        client_email: "vertex@example.iam.gserviceaccount.com",
        private_key:
          "-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----",
      },
      clientOptions: {
        eagerRefreshThresholdMillis: 300000,
        forceRefreshOnFailure: true,
      },
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      projectId: "test-gcp-project",
      universeDomain: "googleapis.com",
    },
  };

  it("preserves Vertex auth params for act requests", () => {
    const result = Api.ActRequestSchema.safeParse({
      input: "click the search button",
      options: {
        model: vertexModel,
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw result.error;
    expect(result.data.options?.model).toEqual(vertexModel);
  });

  it("preserves Vertex auth params for agent model configs", () => {
    const result = Api.AgentExecuteRequestSchema.safeParse({
      agentConfig: {
        model: vertexModel,
        executionModel: vertexModel,
      },
      executeOptions: {
        instruction: "find the search box",
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw result.error;
    expect(result.data.agentConfig.model).toEqual(vertexModel);
    expect(result.data.agentConfig.executionModel).toEqual(vertexModel);
  });
});
