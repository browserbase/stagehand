import { describe, it } from "node:test";
import { Api } from "@browserbasehq/stagehand";

import {
  assertFetchOk,
  assertFetchStatus,
  fetchWithContext,
  getBaseUrl,
  getHeaders,
  HTTP_OK,
} from "../utils.js";

describe("GET /v1/sessions/:id/replay (V3)", () => {
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
