import { describe, expect, it, vi } from "vitest";
import type { Protocol } from "devtools-protocol";
import type { ChromeTabTargetController } from "../understudy/chromeTabs.ts";
import type { CdpConnection } from "../understudy/cdp.ts";
import { BrowserContext } from "../understudy/context.ts";

function createContext(cookies: Protocol.Network.Cookie[]) {
  const send = vi.fn(async (method: string) =>
    method === "Storage.getCookies" ? { cookies } : {},
  );
  const connection = { send } as unknown as CdpConnection;
  const chromeTabs: ChromeTabTargetController = {
    activeTargetId: vi.fn(async () => undefined),
    targetIdForTabId: vi.fn(async () => undefined),
    tabIdForTargetId: vi.fn(async () => undefined),
    activateTarget: vi.fn(async () => {}),
  };
  const context = new BrowserContext(connection, { debug: vi.fn() } as never, chromeTabs);
  return { context, send };
}

function cookie(overrides: Partial<Protocol.Network.Cookie>): Protocol.Network.Cookie {
  return {
    name: "name",
    value: "value",
    domain: "example.com",
    path: "/",
    expires: -1,
    size: 10,
    httpOnly: false,
    secure: true,
    session: true,
    priority: "Medium",
    sourceScheme: "Secure",
    sourcePort: 443,
    ...overrides,
  };
}

describe("BrowserContext.clearCookies with a filter", () => {
  it("re-adds the kept cookies with their partition key, priority and SameSite", async () => {
    const partitionKey = { topLevelSite: "https://shop.test", hasCrossSiteAncestor: false };
    const { context, send } = createContext([
      cookie({ name: "chips", domain: "widget.example", sameSite: "None", partitionKey }),
      cookie({ name: "prio", priority: "High" }),
      cookie({ name: "remove_me" }),
    ]);

    await context.clearCookies({ name: "remove_me" });

    expect(send).toHaveBeenCalledWith("Storage.clearCookies");
    expect(send).toHaveBeenLastCalledWith("Storage.setCookies", {
      cookies: [
        expect.objectContaining({ name: "chips", sameSite: "None", partitionKey }),
        expect.objectContaining({ name: "prio", priority: "High", sameSite: undefined }),
      ],
    });
  });

  it("keeps the expiry of persistent cookies and leaves it out for session cookies", async () => {
    const { context, send } = createContext([
      cookie({ name: "persistent", session: false, expires: 2_000_000_000 }),
      cookie({ name: "session" }),
      cookie({ name: "remove_me" }),
    ]);

    await context.clearCookies({ name: "remove_me" });

    expect(send).toHaveBeenLastCalledWith("Storage.setCookies", {
      cookies: [
        expect.objectContaining({ name: "persistent", expires: 2_000_000_000 }),
        expect.objectContaining({ name: "session", expires: undefined }),
      ],
    });
  });

  it("does nothing when no cookie matches the filter", async () => {
    const { context, send } = createContext([cookie({ name: "keep_me" })]);

    await context.clearCookies({ name: "remove_me" });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("Storage.getCookies");
  });
});
