import { describe, expect, it, vi } from "vitest";

import {
  BrowseCliPageHandle,
  BrowseCliSession,
  browseCliStartupArgs,
  buildBrowseCliProcessArgs,
} from "../../core/tools/browse_cli.js";
import { createBrowseCliSessionName } from "../../browseCliPaths.js";

describe("browse_cli V4 adapter", () => {
  it("places session selection on each V4 command and uses mode-specific startup commands", () => {
    expect(buildBrowseCliProcessArgs("/tmp/browse", "eval-session", ["tab", "list"])).toEqual([
      "/tmp/browse",
      "tab",
      "list",
      "--session",
      "eval-session",
    ]);
    expect(browseCliStartupArgs("LOCAL")).toEqual(["open", "about:blank", "--local"]);
    expect(browseCliStartupArgs("BROWSERBASE")).toEqual(["open", "about:blank", "--remote"]);
  });

  it("keeps eval session names short enough for temporary Unix socket paths", () => {
    const sessionName = createBrowseCliSessionName();

    expect(sessionName).toMatch(/^eval-\d+-[a-z0-9]+-[a-z0-9]{4}$/u);
    expect(sessionName.length).toBeLessThanOrEqual(32);
  });

  it("maps page capabilities onto the V4 command tree and flags", async () => {
    const runJson = vi.fn(async (args: string[]) => {
      if (args[0] === "open") return { url: args[1] };
      if (args[0] === "screenshot") {
        return { base64: Buffer.from("screenshot").toString("base64") };
      }
      if (args[0] === "get" && args[1] === "box") return { x: 12, y: 34 };
      return {};
    });
    const session = {
      runtime: { runJson },
      selectIfNeeded: vi.fn(),
    } as unknown as BrowseCliSession;
    const page = new BrowseCliPageHandle(session, "page-1");

    await page.goto("https://example.com", {
      timeoutMs: 1_234,
      waitUntil: "networkidle",
    });
    await expect(page.screenshot({ fullPage: true, quality: 80, type: "jpeg" })).resolves.toEqual(
      Buffer.from("screenshot"),
    );
    await page.wait({
      kind: "selector",
      selector: "#ready",
      state: "attached",
      timeoutMs: 2_345,
    });
    await page.click(10, 20);
    await page.hover({ kind: "selector", value: "#hover-target" });
    await page.scroll(30, 40, 0, 500);
    await page.type({ kind: "selector", value: "#text-input" }, "hello");
    await page.press({ kind: "coords", x: 50, y: 60 }, "Enter");

    expect(runJson.mock.calls.map(([args]) => args)).toEqual([
      ["open", "https://example.com", "--wait", "networkidle", "--timeout", "1234"],
      ["screenshot", "--base64", "--full-page", "--type", "jpeg", "--quality", "80"],
      ["wait", "selector", "#ready", "--timeout", "2345", "--state", "attached"],
      ["mouse", "click", "10", "20"],
      ["get", "box", "#hover-target"],
      ["mouse", "hover", "12", "34"],
      ["mouse", "scroll", "30", "40", "0", "500"],
      ["fill", "#text-input", "hello"],
      ["mouse", "click", "50", "60"],
      ["press", "Enter"],
    ]);
  });

  it("reads V4 tab-list results and addresses tabs by stable targetId", async () => {
    const session = new BrowseCliSession("eval-session");
    const runJson = vi.spyOn(session.runtime, "runJson").mockImplementation(async (args) => {
      if (args[0] === "tab" && args[1] === "list") {
        return {
          tabs: [
            { index: 0, targetId: "tab-a", url: "about:blank" },
            { index: 1, targetId: "tab-b", url: "https://example.com" },
          ],
        };
      }
      return {};
    });

    await expect(session.listPages()).resolves.toEqual([
      expect.objectContaining({ id: "tab-a" }),
      expect.objectContaining({ id: "tab-b" }),
    ]);
    await session.selectPage("tab-b");

    expect(runJson).toHaveBeenLastCalledWith(["tab", "switch", "tab-b"]);
  });

  it("rejects V4 tab results without a stable targetId", async () => {
    const session = new BrowseCliSession("eval-session");
    vi.spyOn(session.runtime, "runJson").mockResolvedValue({
      tabs: [{ index: 0, url: "about:blank" }],
    });

    await expect(session.listPages()).rejects.toThrow(
      "browse tab list returned no targetId for tab index 0",
    );
  });
});
