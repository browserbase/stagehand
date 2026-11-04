import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Response, type Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

describe("dedicated response callbacks", () => {
  let stagehand: Stagehand;
  let origin: string;
  const server = createServer((request, response) => {
    if (request.url === "/api") {
      response.writeHead(200, { "Content-Type": "application/json", "X-Request-ID": "abc" });
      response.flushHeaders();
      setTimeout(() => response.end('{"ok":true}'), 100);
    } else {
      response.end("<!doctype html><title>Response fixture</title>");
    }
  });
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    stagehand = await createStagehand();
  });
  afterAll(async () => {
    await closeStagehand(stagehand);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("delivers document and fetch responses with lazy bodies, and stops after unsubscribe", async () => {
    const page = await firstPage(stagehand);
    const responses: Response[] = [];
    const bodies: Promise<unknown>[] = [];
    const subscription = await page.onResponse((response) => {
      responses.push(response);
      expect(response).toBeInstanceOf(Response);
      if (response.url().endsWith("/api")) bodies.push(response.json());
    });
    try {
      await page.goto(origin, { waitUntil: "load" });
      await page.evaluate('fetch("/api").then(r => r.text())');
      await expect.poll(() => bodies.length).toBe(1);
      await expect(Promise.all(bodies)).resolves.toEqual([{ ok: true }]);
      expect(responses.some((response) => response.url() === `${origin}/`)).toBe(true);
      expect(responses.filter((response) => response.url().endsWith("/api"))).toHaveLength(1);
      const apiResponse = responses.find((response) => response.url().endsWith("/api"))!;
      expect(await apiResponse.headerValue("x-request-id")).toBe("abc");
      await subscription.unsubscribe();
      const count = responses.length;
      await page.evaluate('fetch("/api").then(r => r.text())');
      expect(responses).toHaveLength(count);
      await expect(apiResponse.json()).resolves.toEqual({ ok: true });
    } finally {
      await subscription.unsubscribe();
    }
  });
});
