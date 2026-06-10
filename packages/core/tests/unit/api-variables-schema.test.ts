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
        ignoreSelectors: [".cookie-banner", "#sidebar-ads"],
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw result.error;
    expect(result.data.options?.ignoreSelectors).toEqual([
      ".cookie-banner",
      "#sidebar-ads",
    ]);
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
    auth: {
      type: "googleServiceAccount",
      credentials: {
        type: "service_account",
        project_id: "test-gcp-project",
        private_key_id: "test-key-id",
        client_email: "vertex@example.iam.gserviceaccount.com",
        private_key:
          "-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----",
        token_uri: "https://oauth2.googleapis.com/token",
      },
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      projectId: "test-gcp-project",
      universeDomain: "googleapis.com",
    },
    providerOptions: {
      vertex: {
        project: "test-gcp-project",
        location: "us-central1",
      },
    },
  };
  const azureModel = {
    provider: "azure",
    modelName: "azure/gpt-4.1-mini",
    auth: {
      type: "azureEntraId",
      token: "test-entra-token",
    },
    providerOptions: {
      azure: {
        resourceName: "test-azure-resource",
        apiVersion: "2024-10-01-preview",
      },
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

  it("preserves Azure Entra auth params for act requests", () => {
    const result = Api.ActRequestSchema.safeParse({
      input: "click the search button",
      options: {
        model: azureModel,
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw result.error;
    expect(result.data.options?.model).toEqual(azureModel);
  });

  it("accepts minimal Vertex service account credentials", () => {
    const result = Api.ActRequestSchema.safeParse({
      input: "click the search button",
      options: {
        model: {
          provider: "vertex",
          modelName: "vertex/gemini-2.5-flash",
          auth: {
            type: "googleServiceAccount",
            credentials: {
              client_email: "vertex@example.iam.gserviceaccount.com",
              private_key:
                "-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----",
            },
          },
          providerOptions: {
            vertex: {
              project: "test-gcp-project",
              location: "us-central1",
            },
          },
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw result.error;
    const parsedModel = result.data.options?.model;
    expect(typeof parsedModel).toBe("object");
    if (typeof parsedModel !== "object" || parsedModel === null) {
      throw new Error("Expected object model config");
    }
    if (!("auth" in parsedModel)) {
      throw new Error("Expected Vertex auth config");
    }
    expect(parsedModel.auth).toEqual({
      type: "googleServiceAccount",
      credentials: {
        client_email: "vertex@example.iam.gserviceaccount.com",
        private_key:
          "-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----",
      },
    });
  });

  it("requires explicit Vertex provider configs to include service account auth and provider options", () => {
    for (const model of [
      {
        provider: "vertex",
        modelName: "vertex/gemini-2.5-flash",
        providerOptions: {
          vertex: {
            project: "test-gcp-project",
            location: "us-central1",
          },
        },
      },
      {
        provider: "vertex",
        modelName: "vertex/gemini-2.5-flash",
        auth: {
          type: "googleServiceAccount",
          credentials: {
            client_email: "vertex@example.iam.gserviceaccount.com",
            private_key:
              "-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----",
          },
        },
      },
    ]) {
      const result = Api.ActRequestSchema.safeParse({
        input: "click the search button",
        options: { model },
      });

      expect(result.success).toBe(false);
    }
  });

  it("requires provider vertex when passing Vertex auth and provider options", () => {
    const result = Api.ActRequestSchema.safeParse({
      input: "click the search button",
      options: {
        model: {
          modelName: "vertex/gemini-2.5-flash",
          auth: {
            type: "googleServiceAccount",
            credentials: {
              client_email: "vertex@example.iam.gserviceaccount.com",
              private_key:
                "-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----",
            },
          },
          providerOptions: {
            vertex: {
              project: "test-gcp-project",
              location: "us-central1",
            },
          },
        },
      },
    });

    expect(result.success).toBe(false);
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

  it("preserves Azure Entra auth params for agent model configs", () => {
    const result = Api.AgentExecuteRequestSchema.safeParse({
      agentConfig: {
        model: azureModel,
        executionModel: azureModel,
      },
      executeOptions: {
        instruction: "find the search box",
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw result.error;
    expect(result.data.agentConfig.model).toEqual(azureModel);
    expect(result.data.agentConfig.executionModel).toEqual(azureModel);
  });

  it("rejects Azure Entra auth when the provider is not azure", () => {
    const result = Api.ActRequestSchema.safeParse({
      input: "click the search button",
      options: {
        model: {
          modelName: "azure/gpt-4.1-mini",
          auth: {
            type: "azureEntraId",
            token: "test-entra-token",
          },
          providerOptions: {
            azure: {
              resourceName: "test-azure-resource",
            },
          },
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects Azure configs that provide both apiKey and Entra auth", () => {
    const result = Api.ActRequestSchema.safeParse({
      input: "click the search button",
      options: {
        model: {
          ...azureModel,
          apiKey: "test-api-key",
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects Vertex key file paths and external credential sources", () => {
    const topLevelLegacyShape = Api.ActRequestSchema.safeParse({
      input: "click the search button",
      options: {
        model: {
          provider: "vertex",
          modelName: "vertex/gemini-2.5-flash",
          project: "test-gcp-project",
          location: "us-central1",
          googleAuthOptions: {},
        },
      },
    });
    expect(topLevelLegacyShape.success).toBe(false);

    for (const blockedAuthOptions of [
      { keyFilename: "/etc/passwd" },
      { keyFile: "/etc/passwd" },
      { apiKey: "vertex-express-key" },
    ]) {
      const result = Api.ActRequestSchema.safeParse({
        input: "click the search button",
        options: {
          model: {
            provider: "vertex",
            modelName: "vertex/gemini-2.5-flash",
            auth: blockedAuthOptions,
          },
        },
      });

      expect(result.success).toBe(false);
    }

    const externalAccountResult = Api.ActRequestSchema.safeParse({
      input: "click the search button",
      options: {
        model: {
          provider: "vertex",
          modelName: "vertex/gemini-2.5-flash",
          auth: {
            type: "googleServiceAccount",
            credentials: {
              type: "external_account",
              credential_source: {
                file: "/etc/passwd",
              },
            },
          },
        },
      },
    });

    expect(externalAccountResult.success).toBe(false);
  });
});
