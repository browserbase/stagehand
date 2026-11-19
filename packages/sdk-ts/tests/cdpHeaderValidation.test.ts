import { describe, expect, it, vi } from "vitest";
import { LocalBrowserConnectOptionsSchema } from "../src/clientSchemas.js";
import { createBrowserFactoriesForTest } from "../src/browser/factories.js";

describe("CDP header validation", () => {
  it.each([
    null,
    [],
    "secret-value",
    { "secret-name": 42 },
    { "secret-name": null },
    { "secret-name": ["secret-value"] },
    { "secret-name": { token: "secret-value" } },
    { "": "secret-value" },
    { "secret name": "secret-value" },
    { "secret-name\n": "secret-value" },
    { "secret:name": "secret-value" },
    ...["\r", "\n", "\0", "\x7f", "é", "😀"].map((character) => ({
      "secret-name": `secret${character}value`,
    })),
    ...[" secret-value", "secret-value ", "\tsecret-value", "secret-value\t", "secret-value\n"].map(
      (value) => ({ "secret-name": value }),
    ),
  ])("rejects malformed headers without exposing them %#", async (headers) => {
    const result = LocalBrowserConnectOptionsSchema.safeParse(
      { cdpUrl: "ws://gw", headers },
      { reportInput: true },
    );
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected invalid headers");
    expect(result.error.issues[0]?.path).toEqual(["headers"]);
    for (const rendered of [
      result.error.message,
      JSON.stringify(result.error.issues),
      JSON.stringify(result.error),
    ]) {
      expect(rendered).not.toContain("secret");
    }
    const connectCdp = vi.fn();
    const { localBrowser } = createBrowserFactoriesForTest({ connectCdp });
    await expect(
      localBrowser.connect({ cdpUrl: "ws://gw", headers: headers as never }),
    ).rejects.toThrow();
    expect(connectCdp).not.toHaveBeenCalled();
  });

  it.each(["getter", "getPrototypeOf", "ownKeys", "getOwnPropertyDescriptor"] as const)(
    "sanitizes a throwing %s during header inspection",
    async (kind) => {
      const fail = () => {
        throw new Error("secret-credential");
      };
      const headers =
        kind === "getter"
          ? Object.defineProperty({}, "Authorization", { enumerable: true, get: fail })
          : new Proxy({ Authorization: "secret-credential" }, { [kind]: fail });
      const result = LocalBrowserConnectOptionsSchema.safeParse(
        { cdpUrl: "ws://gw", headers },
        { reportInput: true },
      );
      expect(result.success).toBe(false);
      if (result.success) throw new Error("Expected invalid headers");
      expect(result.error.issues[0]?.path).toEqual(["headers"]);
      expect(result.error.message).toContain("headers must map valid HTTP header names");
      for (const rendered of [
        result.error.message,
        JSON.stringify(result.error.issues),
        JSON.stringify(result.error),
      ]) {
        expect(rendered).not.toContain("secret-credential");
      }
      const connectCdp = vi.fn();
      const { localBrowser } = createBrowserFactoriesForTest({ connectCdp });
      await expect(localBrowser.connect({ cdpUrl: "ws://gw", headers })).rejects.toThrow(
        "headers must map valid HTTP header names",
      );
      expect(connectCdp).not.toHaveBeenCalled();
    },
  );

  it("passes a validated snapshot to Zod without reading getters again", () => {
    const getter = vi
      .fn()
      .mockReturnValueOnce("token")
      .mockImplementation(() => {
        throw new Error("secret-credential");
      });
    const headers = Object.defineProperty({}, "Authorization", { enumerable: true, get: getter });
    expect(LocalBrowserConnectOptionsSchema.parse({ cdpUrl: "ws://gw", headers }).headers).toEqual({
      Authorization: "token",
    });
    expect(getter).toHaveBeenCalledOnce();
  });

  it.each([
    undefined,
    {},
    { Authorization: "Bearer token", "X-Key": "" },
    { "X-Key": "internal space\ttab" },
  ])("accepts valid headers %#", (headers) => {
    expect(LocalBrowserConnectOptionsSchema.parse({ cdpUrl: "ws://gw", headers }).headers).toEqual(
      headers,
    );
  });
});
