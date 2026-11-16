import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getOpenCommand, openUrl } from "../src/lib/open-url.js";

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
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: true,
  });
  vi.mocked(spawn).mockReturnValue(createMockChild());
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
