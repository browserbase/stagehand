import { describe, it } from "node:test";
import { Api } from "@browserbasehq/stagehand";

import {
  assertFetchOk,
  assertFetchStatus,
  fetchWithContext,
  getBaseUrl,
  getHeaders,
  HTTP_OK,
  HTTP_UNAUTHORIZED,
} from "../utils.js";

describe("GET /v1/sessions/:id/replay (V3)", () => {
  it("rejects requests without authentication", async () => {
    const ctx = await fetchWithContext<unknown>(
      `${getBaseUrl()}/v1/sessions/test-session-id/replay`,
      { method: "GET" },
    );

    assertFetchStatus(
      ctx,
      HTTP_UNAUTHORIZED,
      "Replay should reject missing authentication",
    );
  });

  it("rejects requests with an invalid self-hosted server key", async () => {
    const ctx = await fetchWithContext<unknown>(
      `${getBaseUrl()}/v1/sessions/test-session-id/replay`,
      {
        method: "GET",
        headers: { "x-stagehand-api-key": "invalid-key" },
      },
    );

    assertFetchStatus(
      ctx,
      HTTP_UNAUTHORIZED,
      "Replay should reject invalid authentication",
    );
  });

  it("should return an empty replay result for local server", async () => {
    const url = getBaseUrl();
    const headers = getHeaders("3.0.0");

    const ctx = await fetchWithContext<unknown>(
      `${url}/v1/sessions/test-session-id/replay`,
      {
        method: "GET",
        headers,
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Replay should return 200");
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    const parsedBody = Api.ReplayResponseSchema.safeParse(ctx.body);
    assertFetchOk(
      parsedBody.success,
      "Replay response should match schema",
      ctx,
    );
    if (!parsedBody.success) {
      return;
    }

    assertFetchOk(
      parsedBody.data.success,
      "Response should indicate success",
      ctx,
    );
    assertFetchOk(
      parsedBody.data.data !== undefined,
      "Response should include data",
      ctx,
    );
    assertFetchOk(
      Array.isArray(parsedBody.data.data.pages),
      "Replay pages should be an array",
      ctx,
    );
    assertFetchOk(
      parsedBody.data.data.pages.length === 0,
      "Replay pages should be empty on local server",
      ctx,
    );
  });
});
