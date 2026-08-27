import { describe, expect, it, vi } from "vitest";
import { createBrowserbaseServicesClient } from "../../src/browser/browserbaseServices.js";

describe("Browserbase services client", () => {
  it("proxies search and fetch through the official Browserbase SDK", async () => {
    const searchWeb = vi.fn(async () => ({
      query: "browser agents",
      requestId: "request_123",
      results: [
        {
          id: "result_123",
          title: "Stagehand",
          url: "https://stagehand.dev",
          author: null,
          favicon: null,
          image: null,
          publishedDate: null,
        },
      ],
    }));
    const fetchCreate = vi.fn(async () => ({
      id: "fetch_123",
      content: "# Stagehand",
      contentType: "text/markdown",
      encoding: "utf-8",
      headers: { "content-type": "text/html" },
      statusCode: 200,
    }));
    const createSdk = vi.fn(() => ({
      search: { web: searchWeb },
      fetchAPI: { create: fetchCreate },
    }));
    const client = createBrowserbaseServicesClient(
      "bb_key",
      "https://api.dev.browserbase.com",
      createSdk,
    );

    await expect(client.search({ query: "browser agents", numResults: 5 })).resolves.toMatchObject({
      requestId: "request_123",
      results: [{ author: null, publishedDate: null }],
    });
    await expect(
      client.fetch({ url: "https://stagehand.dev", format: "markdown" }),
    ).resolves.toMatchObject({ statusCode: 200 });

    expect(createSdk).toHaveBeenCalledWith("bb_key", "https://api.dev.browserbase.com");
    expect(searchWeb).toHaveBeenCalledWith({ query: "browser agents", numResults: 5 });
    expect(fetchCreate).toHaveBeenCalledWith({
      url: "https://stagehand.dev",
      format: "markdown",
    });
  });
});
