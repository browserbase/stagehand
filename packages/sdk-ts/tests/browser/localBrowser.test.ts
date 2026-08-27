import { describe, expect, it, vi } from "vitest";
import { launchLocalBrowser, localBrowserChromeFlags } from "../../src/browser/localBrowser.js";

const launch = vi.fn(async (_options: Record<string, unknown>) => ({
  kill: vi.fn(),
  port: 9222,
}));

vi.mock("chrome-launcher", () => ({
  getChromePath: () => "/usr/bin/chrome",
  launch,
  Launcher: { defaultFlags: () => [] },
}));

describe("local browser launch", () => {
  it("passes userDataDir as a Chrome flag instead of a launcher option", async () => {
    await launchLocalBrowser({ userDataDir: "/home/user/project/chrome-profile" });

    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        chromeFlags: expect.arrayContaining(["--user-data-dir=/home/user/project/chrome-profile"]),
      }),
    );
    expect(launch.mock.calls[0]?.[0]).not.toHaveProperty("userDataDir");
  });

  it("includes userDataDir when composing Chrome flags", () => {
    expect(
      localBrowserChromeFlags({ userDataDir: "/home/user/project/chrome-profile" }, [], false),
    ).toContain("--user-data-dir=/home/user/project/chrome-profile");
  });
});
