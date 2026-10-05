import assert from "node:assert/strict";
import { test } from "node:test";
import { downloadCover } from "../src/download.js";

await test("rejects model-generated off-host URLs before making any request", async () => {
  for (const url of [
    "https://localhost/a",
    "http://books.toscrape.com/a",
    "https://books.toscrape.com:8443/a",
    "https://user@books.toscrape.com/a",
  ]) {
    await assert.rejects(
      downloadCover(new URL(url), async () => {
        throw new Error("should not fetch");
      }),
      /Cover URL/,
    );
  }
});
await test("bounds streamed download and verifies JPEG bytes", async () => {
  const url = new URL("https://books.toscrape.com/cover.jpg");
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x01]);
  assert.deepEqual(
    await downloadCover(url, async (_, options) => {
      assert.equal(options?.redirect, "error");
      return new Response(bytes, { headers: { "content-type": "image/jpeg" } });
    }),
    bytes,
  );
  await assert.rejects(
    downloadCover(url, async () => new Response("html")),
    /not an image/,
  );
  await assert.rejects(
    downloadCover(
      url,
      async () => new Response("html", { headers: { "content-type": "image/jpeg" } }),
    ),
    /not a JPEG/,
  );
  await assert.rejects(
    downloadCover(
      url,
      async () =>
        new Response(new Uint8Array(5 * 1024 * 1024 + 1), {
          headers: { "content-type": "image/jpeg" },
        }),
    ),
    /5 MiB/,
  );
});
