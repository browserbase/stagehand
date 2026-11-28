import { beforeEach, describe, expect, it, vi } from "vitest";

const { runDriverCommandFromFlags } = vi.hoisted(() => ({
  runDriverCommandFromFlags: vi.fn(),
}));

vi.mock("../src/lib/driver/command-cli.js", () => ({
  driverCommandFlags: {},
  runDriverCommandFromFlags,
}));

import TabNew from "../src/commands/tab/new.js";

function createTabNewCommand(url?: string, flags: Record<string, unknown> = {}): TabNew {
  const cmd = Object.create(TabNew.prototype) as TabNew;
  vi.spyOn(cmd as unknown as { parse: () => Promise<unknown> }, "parse").mockResolvedValue({
    args: { url },
    flags,
  });
  return cmd;
}

describe("browse tab new URL normalization", () => {
  beforeEach(() => {
    runDriverCommandFromFlags.mockReset();
    runDriverCommandFromFlags.mockResolvedValue(undefined);
  });

  it("prefixes https:// for bare domains", async () => {
    const flags = { session: "research" };
    await createTabNewCommand("example.com", flags).run();

    expect(runDriverCommandFromFlags).toHaveBeenCalledWith(
      "tab.new",
      { url: "https://example.com" },
      flags,
    );
  });

  it("prefixes http:// for bare localhost and loopback hosts", async () => {
    await createTabNewCommand("localhost:8123").run();
    expect(runDriverCommandFromFlags).toHaveBeenLastCalledWith(
      "tab.new",
      { url: "http://localhost:8123" },
      {},
    );

    await createTabNewCommand("127.0.0.1:3000/test").run();
    expect(runDriverCommandFromFlags).toHaveBeenLastCalledWith(
      "tab.new",
      { url: "http://127.0.0.1:3000/test" },
      {},
    );
  });

  it("leaves explicit schemes unchanged", async () => {
    await createTabNewCommand("https://example.com/path").run();
    expect(runDriverCommandFromFlags).toHaveBeenLastCalledWith(
      "tab.new",
      { url: "https://example.com/path" },
      {},
    );

    await createTabNewCommand("about:blank").run();
    expect(runDriverCommandFromFlags).toHaveBeenLastCalledWith(
      "tab.new",
      { url: "about:blank" },
      {},
    );
  });

  it("passes undefined when no URL argument is provided", async () => {
    await createTabNewCommand(undefined).run();

    expect(runDriverCommandFromFlags).toHaveBeenCalledWith("tab.new", { url: undefined }, {});
  });
});
