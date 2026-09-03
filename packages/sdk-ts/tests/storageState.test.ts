import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserContext } from "../src/browserContext.js";
import { StagehandMethods } from "../../protocol/schema-registry.js";
import type { Cookie } from "../../protocol/types.js";
import type { StagehandCommandClient } from "../src/commandClient.js";

const sampleCookie: Cookie = {
  name: "session",
  value: "secret",
  domain: "example.com",
  path: "/",
  expires: -1,
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
};

function mockClient(cookies: Cookie[] = [sampleCookie]): {
  client: StagehandCommandClient;
  calls: Array<{ method: string; params: unknown }>;
} {
  const calls: Array<{ method: string; params: unknown }> = [];
  const client: StagehandCommandClient = {
    send: async (method, params) => {
      calls.push({ method: method.name, params });
      if (method === StagehandMethods.contextCookies) {
        return cookies;
      }
      if (
        method === StagehandMethods.contextAddCookies ||
        method === StagehandMethods.contextClearCookies
      ) {
        return undefined;
      }
      throw new Error(`unexpected method ${method.name}`);
    },
    onNotification: () => () => {},
  };
  return { client, calls };
}

describe("BrowserContext.storageState", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("exports cookies with an empty origins list", async () => {
    const { client, calls } = mockClient();
    const context = new BrowserContext(client);

    await expect(context.storageState()).resolves.toStrictEqual({
      cookies: [sampleCookie],
      origins: [],
    });
    expect(calls).toEqual([{ method: "context.cookies", params: {} }]);
  });

  it("writes Playwright-compatible JSON when path is set", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "stagehand-storage-state-"));
    const filePath = path.join(tempDir, "state.json");
    const { client } = mockClient();
    const context = new BrowserContext(client);

    await context.storageState({ path: filePath });

    const written = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    expect(written).toStrictEqual({
      cookies: [sampleCookie],
      origins: [],
    });
  });

  it("restores cookies from an object after clearing", async () => {
    const { client, calls } = mockClient([]);
    const context = new BrowserContext(client);

    await context.setStorageState({ cookies: [sampleCookie], origins: [] });

    expect(calls.map((call) => call.method)).toEqual([
      "context.clear_cookies",
      "context.add_cookies",
    ]);
    expect(calls[1]?.params).toStrictEqual({
      cookies: [
        {
          name: "session",
          value: "secret",
          domain: "example.com",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ],
    });
  });

  it("restores cookies from a JSON file and accepts snake_case keys", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "stagehand-storage-state-"));
    const filePath = path.join(tempDir, "state.json");
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(
        filePath,
        JSON.stringify({
          cookies: [
            {
              name: "session",
              value: "secret",
              domain: "example.com",
              path: "/",
              expires: -1,
              http_only: true,
              secure: true,
              same_site: "Lax",
            },
          ],
        }),
        "utf8",
      ),
    );
    const { client, calls } = mockClient([]);
    const context = new BrowserContext(client);

    await context.setStorageState(filePath);

    expect(calls.map((call) => call.method)).toEqual([
      "context.clear_cookies",
      "context.add_cookies",
    ]);
    expect(
      (calls[1]?.params as { cookies: Cookie[] }).cookies[0]?.httpOnly,
    ).toBe(true);
  });

  it("rejects malformed storage state", async () => {
    const { client } = mockClient([]);
    const context = new BrowserContext(client);
    await expect(context.setStorageState({} as never)).rejects.toThrow(
      /cookies array/,
    );
  });

  it("normalizes empty sameSite to Lax on export and restore", async () => {
    const emptySameSite = { ...sampleCookie, sameSite: "" as Cookie["sameSite"] };
    const { client, calls } = mockClient([emptySameSite]);
    const context = new BrowserContext(client);

    await expect(context.storageState()).resolves.toStrictEqual({
      cookies: [{ ...sampleCookie, sameSite: "Lax" }],
      origins: [],
    });

    await context.setStorageState({
      cookies: [emptySameSite],
      origins: [{ origin: "https://example.com", localStorage: [] }],
    });
    expect(calls.map((call) => call.method)).toEqual([
      "context.cookies",
      "context.clear_cookies",
      "context.add_cookies",
    ]);
    expect(calls[2]?.params).toStrictEqual({
      cookies: [
        {
          name: "session",
          value: "secret",
          domain: "example.com",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ],
    });
  });
});
