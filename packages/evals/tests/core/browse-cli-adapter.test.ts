import { describe, expect, it, vi } from "vitest";
import { BrowseCliSession } from "../../core/tools/browse_cli.js";

describe("workspace Browse adapter", () => {
  it("preserves page identity when tabs are reordered and addresses commands by target ID", async () => {
    const session = new BrowseCliSession("eval-session");
    let tabs = [
      { index: 0, targetId: "tab-a", url: "about:blank" },
      { index: 1, targetId: "tab-b", url: "https://example.com" },
    ];
    const runJson = vi.spyOn(session.runtime, "runJson").mockImplementation(async (args) => {
      if (args[0] === "tab" && args[1] === "list") return { tabs };
      if (args[0] === "tab" && args[1] === "close") {
        tabs = tabs.filter((tab) => tab.targetId !== args[2]);
      }
      return {};
    });

    const [, secondPage] = await session.listPages();
    tabs = [
      { index: 0, targetId: "tab-b", url: "https://example.com/updated" },
      { index: 1, targetId: "tab-a", url: "about:blank" },
    ];
    const reorderedPages = await session.listPages();
    expect(reorderedPages[0]).toBe(secondPage);
    expect(secondPage.url()).toBe("https://example.com/updated");

    await session.selectPage(secondPage.id);
    expect(runJson).toHaveBeenLastCalledWith(["tab", "switch", "tab-b"]);
    await session.closePage(secondPage.id);
    expect(runJson).toHaveBeenCalledWith(["tab", "close", "tab-b"]);
    await expect(session.listPages()).resolves.toEqual([expect.objectContaining({ id: "tab-a" })]);
  });

  it("rejects tab results that cannot identify a page reliably", async () => {
    const session = new BrowseCliSession("eval-session");
    vi.spyOn(session.runtime, "runJson").mockResolvedValue({
      tabs: [{ index: 0, url: "about:blank" }],
    });

    await expect(session.listPages()).rejects.toThrow(
      "browse tab list returned no targetId for tab index 0",
    );
  });
});
