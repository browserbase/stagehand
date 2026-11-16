import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getOpenCommand, openUrl, platformDetection } from "../src/lib/open-url.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

const url = "https://example.com/community";
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
  vi.stubEnv("BROWSER", undefined);
  vi.stubEnv("WSL_DISTRO_NAME", undefined);
  vi.stubEnv("SSH_CONNECTION", undefined);
  vi.stubEnv("SSH_TTY", undefined);
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: true,
  });
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
  it("returns open command for darwin", () => {
    const { command, args } = getOpenCommand(url, "darwin");
    expect(command).toBe("open");
    expect(args).toEqual([url]);
  });

  it("returns xdg-open command for linux", () => {
    const { command, args } = getOpenCommand(url, "linux");
    expect(command).toBe("xdg-open");
    expect(args).toEqual([url]);
  });

  it("returns rundll32 command for win32", () => {
    const { command, args } = getOpenCommand(url, "win32");
    expect(command).toBe("rundll32");
    expect(args).toEqual(["url.dll,FileProtocolHandler", url]);
  });

  it("falls back to xdg-open for unknown platforms", () => {
    const { command, args } = getOpenCommand(url, "freebsd" as NodeJS.Platform);
    expect(command).toBe("xdg-open");
    expect(args).toEqual([url]);
  });

  describe("$BROWSER override", () => {
    it("uses $BROWSER when set on Linux", () => {
      vi.mocked(platformDetection.getBrowser).mockReturnValue("firefox");

      const { command, args } = getOpenCommand(url, "linux");
      expect(command).toBe("firefox");
      expect(args).toEqual([url]);
    });

    it("$BROWSER takes precedence over WSL detection", () => {
      vi.mocked(platformDetection.getBrowser).mockReturnValue("chromium");
      vi.mocked(platformDetection.isWsl).mockReturnValue(true);

      const { command, args } = getOpenCommand(url, "linux");
      expect(command).toBe("chromium");
      expect(args).toEqual([url]);
    });

    it("does not affect darwin", () => {
      vi.mocked(platformDetection.getBrowser).mockReturnValue("firefox");

      const { command } = getOpenCommand(url, "darwin");
      expect(command).toBe("open");
    });

    it("does not affect win32", () => {
      vi.mocked(platformDetection.getBrowser).mockReturnValue("firefox");

      const { command } = getOpenCommand(url, "win32");
      expect(command).toBe("rundll32");
    });
  });

  describe("WSL detection", () => {
    it("uses rundll32.exe when WSL_DISTRO_NAME is set", () => {
      vi.mocked(platformDetection.isWsl).mockReturnValue(true);

      const { command, args, fallback } = getOpenCommand(url, "linux");
      expect(command).toBe("rundll32.exe");
      expect(args).toEqual(["url.dll,FileProtocolHandler", url]);
      expect(fallback).toEqual({ command: "xdg-open", args: [url] });
    });

    it("uses rundll32.exe when /proc/version contains microsoft", () => {
      vi.mocked(platformDetection.isWsl).mockReturnValue(true);

      const { command, args } = getOpenCommand(url, "linux");
      expect(command).toBe("rundll32.exe");
      expect(args).toEqual(["url.dll,FileProtocolHandler", url]);
    });

    it("uses xdg-open when in WSL over SSH (SSH_CONNECTION set)", () => {
      vi.mocked(platformDetection.isWsl).mockReturnValue(true);
      vi.mocked(platformDetection.isSSH).mockReturnValue(true);

      const { command, args, fallback } = getOpenCommand(url, "linux");
      expect(command).toBe("xdg-open");
      expect(args).toEqual([url]);
      expect(fallback).toBeUndefined();
    });

    it("uses xdg-open when in WSL over SSH (SSH_TTY set)", () => {
      vi.mocked(platformDetection.isWsl).mockReturnValue(true);
      vi.mocked(platformDetection.isSSH).mockReturnValue(true);

      const { command, args } = getOpenCommand(url, "linux");
      expect(command).toBe("xdg-open");
      expect(args).toEqual([url]);
    });

    it("passes URL with & untouched on WSL path", () => {
      vi.mocked(platformDetection.isWsl).mockReturnValue(true);
      const urlWithAmpersand = "https://discord.gg/invite?a=1&b=2&c=3";

      const { args } = getOpenCommand(urlWithAmpersand, "linux");
      expect(args[1]).toBe(urlWithAmpersand);
    });
  });

  describe("URL passed as single untouched argv element", () => {
    const specialUrls = [
      "https://example.com/path?foo=bar&baz=qux",
      "https://example.com/path?a=1&b=2&c=3",
      "https://example.com/path#section",
      "https://example.com/path?query=value#anchor",
      "https://example.com/path%20with%20spaces",
      "https://example.com/path?param=hello%20world",
    ];

    for (const testUrl of specialUrls) {
      it(`preserves URL with special characters: ${testUrl}`, () => {
        for (const platform of ["darwin", "linux", "win32"] as NodeJS.Platform[]) {
          const { args } = getOpenCommand(testUrl, platform);
          const urlArg = platform === "win32" ? args[1] : args[0];
          expect(urlArg).toBe(testUrl);
        }
      });
    }
  });
});

describe("platformDetection", () => {
  describe("isSSH", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("returns true when SSH_CONNECTION is set", () => {
      vi.stubEnv("SSH_CONNECTION", "192.168.1.1 22 192.168.1.2 12345");
      expect(platformDetection.isSSH()).toBe(true);
    });

    it("returns true when SSH_TTY is set", () => {
      vi.stubEnv("SSH_TTY", "/dev/pts/0");
      expect(platformDetection.isSSH()).toBe(true);
    });

    it("returns false when neither SSH env is set", () => {
      expect(platformDetection.isSSH()).toBe(false);
    });
  });

  describe("getBrowser", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("returns BROWSER env value when set", () => {
      vi.stubEnv("BROWSER", "firefox");
      expect(platformDetection.getBrowser()).toBe("firefox");
    });

    it("returns undefined when BROWSER is not set", () => {
      expect(platformDetection.getBrowser()).toBeUndefined();
    });

    it("returns undefined when BROWSER is empty", () => {
      vi.stubEnv("BROWSER", "");
      expect(platformDetection.getBrowser()).toBeUndefined();
    });
  });
});

describe("openUrl", () => {
  describe("TTY and CI gating", () => {
    it("does not spawn when noOpen is set in an interactive terminal", () => {
      expect(openUrl(url, { noOpen: true })).toEqual({ attempted: false, success: true });
      expect(spawn).not.toHaveBeenCalled();
    });

    it("does not spawn when stdout is not a TTY", () => {
      Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false });

      expect(openUrl(url)).toEqual({ attempted: false, success: true });
      expect(spawn).not.toHaveBeenCalled();
    });

    it.each(["true", "1", "yes", "on", "TRUE", " True "])(
      "does not spawn in an interactive terminal with CI=%s",
      (ci) => {
        vi.stubEnv("CI", ci);

        expect(openUrl(url)).toEqual({ attempted: false, success: true });
        expect(spawn).not.toHaveBeenCalled();
      },
    );

    it.each(["", "false", "FALSE", " false "])("spawns opener with CI=%j", (ci) => {
      vi.stubEnv("CI", ci);

      expect(openUrl(url)).toEqual({ attempted: true, success: true });
      expect(spawn).toHaveBeenCalledOnce();
    });

    it("spawns opener when CI is undefined", () => {
      vi.stubEnv("CI", undefined);

      expect(openUrl(url)).toEqual({ attempted: true, success: true });
      expect(spawn).toHaveBeenCalledOnce();
    });
  });

  describe("spawn options", () => {
    it("spawns with shell: false, detached: true, stdio: ignore", () => {
      openUrl(url);

      expect(spawn).toHaveBeenCalledOnce();
      const spawnOptions = vi.mocked(spawn).mock.calls[0][2] as SpawnOptions;
      expect(spawnOptions.shell).toBe(false);
      expect(spawnOptions.detached).toBe(true);
      expect(spawnOptions.stdio).toBe("ignore");
    });

    it("calls unref on the child process", () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      openUrl(url);

      expect(mockChild.unref).toHaveBeenCalledOnce();
    });
  });

  describe("platform-specific commands", () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("uses open on darwin", () => {
      Object.defineProperty(process, "platform", { value: "darwin" });

      openUrl(url);

      expect(spawn).toHaveBeenCalledWith("open", [url], expect.any(Object));
    });

    it("uses xdg-open on linux", () => {
      Object.defineProperty(process, "platform", { value: "linux" });

      openUrl(url);

      expect(spawn).toHaveBeenCalledWith("xdg-open", [url], expect.any(Object));
    });

    it("uses rundll32 on win32", () => {
      Object.defineProperty(process, "platform", { value: "win32" });

      openUrl(url);

      expect(spawn).toHaveBeenCalledWith(
        "rundll32",
        ["url.dll,FileProtocolHandler", url],
        expect.any(Object),
      );
    });
  });

  describe("error handling", () => {
    it("handles synchronous spawn failure without throwing", () => {
      vi.mocked(spawn).mockImplementation(() => {
        throw new Error("spawn failed");
      });

      expect(openUrl(url)).toEqual({ attempted: true, success: false });
    });

    it("swallows async ENOENT error without crashing", () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const result = openUrl(url);

      // Verify an error listener was registered
      expect(mockChild.listenerCount("error")).toBe(1);

      // Emit an ENOENT error (opener not found)
      const enoentError = Object.assign(new Error("spawn xdg-open ENOENT"), { code: "ENOENT" });
      expect(() => mockChild.emit("error", enoentError)).not.toThrow();

      // The result was already returned as success since spawn() itself succeeded
      expect(result).toEqual({ attempted: true, success: true });
    });

    it("swallows async EACCES error without crashing", () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      openUrl(url);

      const eaccesError = Object.assign(new Error("spawn xdg-open EACCES"), { code: "EACCES" });
      expect(() => mockChild.emit("error", eaccesError)).not.toThrow();
    });
  });

  describe("WSL fallback", () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "linux" });
    });

    afterEach(() => {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("falls back to xdg-open when rundll32.exe ENOENT in WSL", () => {
      vi.mocked(platformDetection.isWsl).mockReturnValue(true);

      const primaryChild = createMockChild();
      const fallbackChild = createMockChild();
      let spawnCallCount = 0;
      vi.mocked(spawn).mockImplementation(() => {
        spawnCallCount++;
        return spawnCallCount === 1 ? primaryChild : fallbackChild;
      });

      openUrl(url);

      // First spawn is rundll32.exe
      expect(spawn).toHaveBeenCalledWith(
        "rundll32.exe",
        ["url.dll,FileProtocolHandler", url],
        expect.any(Object),
      );

      // Emit error on primary child
      const enoentError = Object.assign(new Error("spawn rundll32.exe ENOENT"), { code: "ENOENT" });
      primaryChild.emit("error", enoentError);

      // Fallback should have been spawned
      expect(spawn).toHaveBeenCalledWith("xdg-open", [url], expect.any(Object));
      expect(fallbackChild.unref).toHaveBeenCalled();
    });

    it("fallback child also has error listener", () => {
      vi.mocked(platformDetection.isWsl).mockReturnValue(true);

      const primaryChild = createMockChild();
      const fallbackChild = createMockChild();
      let spawnCallCount = 0;
      vi.mocked(spawn).mockImplementation(() => {
        spawnCallCount++;
        return spawnCallCount === 1 ? primaryChild : fallbackChild;
      });

      openUrl(url);
      primaryChild.emit("error", new Error("ENOENT"));

      // Fallback child should have an error listener
      expect(fallbackChild.listenerCount("error")).toBe(1);
      // And it should not throw when error is emitted
      expect(() => fallbackChild.emit("error", new Error("ENOENT"))).not.toThrow();
    });

    it("handles synchronous fallback spawn failure", () => {
      vi.mocked(platformDetection.isWsl).mockReturnValue(true);

      const primaryChild = createMockChild();
      let spawnCallCount = 0;
      vi.mocked(spawn).mockImplementation(() => {
        spawnCallCount++;
        if (spawnCallCount === 1) return primaryChild;
        throw new Error("fallback spawn failed");
      });

      openUrl(url);

      // Should not throw when primary errors and fallback spawn fails
      expect(() => primaryChild.emit("error", new Error("ENOENT"))).not.toThrow();
    });
  });

  describe("URL integrity", () => {
    const urlsWithSpecialChars = [
      { description: "ampersand", url: "https://discord.gg/invite?a=1&b=2" },
      { description: "query and hash", url: "https://example.com/path?query=1#hash" },
      { description: "encoded spaces", url: "https://example.com/path%20with%20spaces" },
      { description: "multiple ampersands", url: "https://example.com/?x=1&y=2&z=3&w=4" },
    ];

    for (const { description, url: testUrl } of urlsWithSpecialChars) {
      it(`passes URL with ${description} as a single argument`, () => {
        openUrl(testUrl);

        const args = vi.mocked(spawn).mock.calls[0][1] as string[];
        // The URL should appear exactly once in args, untouched
        const urlOccurrences = args.filter((arg) => arg === testUrl);
        expect(urlOccurrences).toHaveLength(1);
      });
    }
  });
});
