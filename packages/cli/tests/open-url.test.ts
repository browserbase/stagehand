import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getOpenCommand, openUrl, platformDetection } from "../src/lib/open-url.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const url = "https://example.com/path";
const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

function createMockChild(): ChildProcess & EventEmitter {
  const child = new EventEmitter() as ChildProcess & EventEmitter;
  child.unref = vi.fn();
  child.pid = 12345;
  return child;
}

beforeEach(() => {
  vi.mocked(spawn).mockReset();
  vi.stubEnv("CI", undefined);
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
  vi.mocked(spawn).mockReturnValue(createMockChild());
  vi.spyOn(platformDetection, "isWsl").mockReturnValue(false);
  vi.spyOn(platformDetection, "isSSH").mockReturnValue(false);
  vi.spyOn(platformDetection, "getBrowser").mockReturnValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (originalIsTTY) Object.defineProperty(process.stdout, "isTTY", originalIsTTY);
  else Reflect.deleteProperty(process.stdout, "isTTY");
});

describe("getOpenCommand", () => {
  const commandTable: Array<{
    name: string;
    platform: NodeJS.Platform;
    browser?: string;
    wsl?: boolean;
    ssh?: boolean;
    command: string;
    args: string[];
    hasFallback?: boolean;
  }> = [
    { name: "darwin", platform: "darwin", command: "open", args: [url] },
    {
      name: "win32",
      platform: "win32",
      command: "rundll32",
      args: ["url.dll,FileProtocolHandler", url],
    },
    { name: "linux", platform: "linux", command: "xdg-open", args: [url] },
    {
      name: "freebsd (fallback)",
      platform: "freebsd" as NodeJS.Platform,
      command: "xdg-open",
      args: [url],
    },
    {
      name: "linux + $BROWSER",
      platform: "linux",
      browser: "firefox",
      command: "firefox",
      args: [url],
    },
    {
      name: "linux + $BROWSER + WSL (BROWSER wins)",
      platform: "linux",
      browser: "chromium",
      wsl: true,
      command: "chromium",
      args: [url],
    },
    {
      name: "darwin + $BROWSER (ignored)",
      platform: "darwin",
      browser: "firefox",
      command: "open",
      args: [url],
    },
    {
      name: "win32 + $BROWSER (ignored)",
      platform: "win32",
      browser: "firefox",
      command: "rundll32",
      args: ["url.dll,FileProtocolHandler", url],
    },
    {
      name: "linux + WSL",
      platform: "linux",
      wsl: true,
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", url],
      hasFallback: true,
    },
    {
      name: "linux + WSL + SSH (xdg-open)",
      platform: "linux",
      wsl: true,
      ssh: true,
      command: "xdg-open",
      args: [url],
    },
  ];

  it.each(commandTable)(
    "$name -> $command",
    ({ platform, browser, wsl, ssh, command, args, hasFallback }) => {
      vi.mocked(platformDetection.getBrowser).mockReturnValue(browser);
      vi.mocked(platformDetection.isWsl).mockReturnValue(wsl ?? false);
      vi.mocked(platformDetection.isSSH).mockReturnValue(ssh ?? false);

      const result = getOpenCommand(url, platform);

      expect(result.command).toBe(command);
      expect(result.args).toEqual(args);
      if (hasFallback) {
        expect(result.fallback).toEqual({ command: "xdg-open", args: [url] });
      } else {
        expect(result.fallback).toBeUndefined();
      }
    },
  );

  describe("URL integrity", () => {
    const trickyUrls = [
      "https://example.com/?a=1&b=2&c=3",
      "https://example.com/path?q=1#section",
      "https://example.com/path%20with%20spaces",
    ];

    it.each(trickyUrls)("preserves special chars: %s", (testUrl) => {
      // Test each unique opener path once
      expect(getOpenCommand(testUrl, "darwin").args[0]).toBe(testUrl);
      expect(getOpenCommand(testUrl, "linux").args[0]).toBe(testUrl);
      expect(getOpenCommand(testUrl, "win32").args[1]).toBe(testUrl);

      vi.mocked(platformDetection.isWsl).mockReturnValue(true);
      expect(getOpenCommand(testUrl, "linux").args[1]).toBe(testUrl);
    });
  });
});

describe("platformDetection helpers", () => {
  beforeEach(() => vi.restoreAllMocks());

  it.each([
    { env: "SSH_CONNECTION", value: "192.168.1.1 22 192.168.1.2 12345", expected: true },
    { env: "SSH_TTY", value: "/dev/pts/0", expected: true },
    { env: undefined, value: undefined, expected: false },
  ])("isSSH: $env=$value -> $expected", ({ env, value, expected }) => {
    if (env && value) vi.stubEnv(env, value);
    expect(platformDetection.isSSH()).toBe(expected);
  });

  it.each([
    { value: "firefox", expected: "firefox" },
    { value: "", expected: undefined },
    { value: undefined, expected: undefined },
  ])("getBrowser: BROWSER=$value -> $expected", ({ value, expected }) => {
    if (value !== undefined) vi.stubEnv("BROWSER", value);
    expect(platformDetection.getBrowser()).toBe(expected);
  });
});

describe("openUrl", () => {
  describe("gating", () => {
    const gatingTable: Array<{
      name: string;
      noOpen?: boolean;
      isTTY?: boolean;
      ci?: string;
      spawns: boolean;
    }> = [
      { name: "noOpen=true", noOpen: true, spawns: false },
      { name: "non-TTY", isTTY: false, spawns: false },
      { name: "CI=true", ci: "true", spawns: false },
      { name: "CI=1", ci: "1", spawns: false },
      { name: "CI=yes", ci: "yes", spawns: false },
      { name: "CI=' True '", ci: " True ", spawns: false },
      { name: "CI=false", ci: "false", spawns: true },
      { name: "CI=''", ci: "", spawns: true },
      { name: "CI=undefined", ci: undefined, spawns: true },
      { name: "TTY + no CI", isTTY: true, spawns: true },
    ];

    it.each(gatingTable)("$name -> spawns=$spawns", ({ noOpen, isTTY, ci, spawns }) => {
      if (isTTY !== undefined) {
        Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: isTTY });
      }
      if (ci !== undefined) vi.stubEnv("CI", ci);

      const result = openUrl(url, { noOpen });

      expect(result.attempted).toBe(spawns);
      expect(spawn).toHaveBeenCalledTimes(spawns ? 1 : 0);
    });
  });

  describe("spawn options", () => {
    it("uses shell:false, detached:true, stdio:ignore and calls unref", () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      openUrl(url);

      const opts = vi.mocked(spawn).mock.calls[0][2] as SpawnOptions;
      expect(opts).toMatchObject({ shell: false, detached: true, stdio: "ignore" });
      expect(mockChild.unref).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("returns success:false on synchronous spawn failure", () => {
      vi.mocked(spawn).mockImplementation(() => {
        throw new Error("spawn failed");
      });
      expect(openUrl(url)).toEqual({ attempted: true, success: false });
    });

    it("swallows async ENOENT without crashing", () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      openUrl(url);

      expect(mockChild.listenerCount("error")).toBe(1);
      expect(() =>
        mockChild.emit("error", Object.assign(new Error(), { code: "ENOENT" })),
      ).not.toThrow();
    });
  });

  describe("WSL fallback", () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "linux" });
      vi.mocked(platformDetection.isWsl).mockReturnValue(true);
    });

    afterEach(() => {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("spawns xdg-open when rundll32.exe errors", () => {
      const primary = createMockChild();
      const fallback = createMockChild();
      let callCount = 0;
      vi.mocked(spawn).mockImplementation(() => (++callCount === 1 ? primary : fallback));

      openUrl(url);
      expect(spawn).toHaveBeenCalledWith("rundll32.exe", expect.any(Array), expect.any(Object));

      primary.emit("error", new Error("ENOENT"));

      expect(spawn).toHaveBeenCalledWith("xdg-open", [url], expect.any(Object));
      expect(fallback.unref).toHaveBeenCalled();
      expect(fallback.listenerCount("error")).toBe(1);
    });

    it("handles synchronous fallback spawn failure", () => {
      const primary = createMockChild();
      vi.mocked(spawn)
        .mockImplementationOnce(() => primary)
        .mockImplementation(() => {
          throw new Error("fallback failed");
        });

      openUrl(url);
      expect(() => primary.emit("error", new Error())).not.toThrow();
    });
  });
});
