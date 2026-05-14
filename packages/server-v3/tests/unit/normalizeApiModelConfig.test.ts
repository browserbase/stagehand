import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Api } from "@browserbasehq/stagehand";

import { normalizeApiModelConfig } from "../../src/lib/model.js";

describe("normalizeApiModelConfig", () => {
  it("keeps string model names as-is", () => {
    assert.deepEqual(normalizeApiModelConfig("openai/gpt-5"), {
      modelName: "openai/gpt-5",
    });
  });

  it("maps bedrock providerConfig to providerOptions and strips hosted-only fields", () => {
    const normalized = normalizeApiModelConfig({
      modelName: "bedrock/us.amazon.nova-lite-v1:0",
      provider: "bedrock",
      providerConfig: {
        provider: "bedrock",
        options: {
          region: "us-east-1",
          accessKeyId: "test-access-key",
          secretAccessKey: "test-secret",
          sessionToken: "test-session-token",
          apiKey: "test-bearer-token",
          baseURL: "https://bedrock-proxy.example.com",
          headers: {
            "x-test-header": "ok",
          },
          fetch: "should-not-survive",
        },
      },
    });

    assert.deepEqual(normalized, {
      modelName: "bedrock/us.amazon.nova-lite-v1:0",
      providerOptions: {
        region: "us-east-1",
        accessKeyId: "test-access-key",
        secretAccessKey: "test-secret",
        sessionToken: "test-session-token",
        apiKey: "test-bearer-token",
        baseURL: "https://bedrock-proxy.example.com",
        headers: {
          "x-test-header": "ok",
        },
      },
    });
  });

  it("maps vertex providerConfig to providerOptions and keeps only serializable auth fields", () => {
    const normalized = normalizeApiModelConfig({
      providerConfig: {
        provider: "vertex",
        options: {
          project: "demo-project",
          location: "us-central1",
          baseURL: "https://vertex-proxy.example.com",
          headers: {
            "x-vertex-header": "ok",
          },
          googleAuthOptions: {
            credentials: {
              client_email: "stagehand@test.iam.gserviceaccount.com",
              private_key: "private-key",
              universe_domain: "googleapis.com",
            },
            scopes: ["scope-a", "scope-b"],
            projectId: "demo-project",
            universeDomain: "googleapis.com",
            fetch: "should-not-survive",
          },
          fetch: "should-not-survive",
        },
      },
    } as unknown as Api.ModelConfig);

    assert.deepEqual(normalized, {
      modelName: "gpt-4o",
      providerOptions: {
        project: "demo-project",
        location: "us-central1",
        baseURL: "https://vertex-proxy.example.com",
        headers: {
          "x-vertex-header": "ok",
        },
        googleAuthOptions: {
          credentials: {
            client_email: "stagehand@test.iam.gserviceaccount.com",
            private_key: "private-key",
            universe_domain: "googleapis.com",
          },
          scopes: ["scope-a", "scope-b"],
          projectId: "demo-project",
          universeDomain: "googleapis.com",
        },
      },
    });
  });
});
