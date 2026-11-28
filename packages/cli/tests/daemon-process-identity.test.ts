import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { isDaemonProcess, killProcess } from "../src/lib/driver/daemon/process.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("node:fs", () => ({ readFileSync: vi.fn() }));

const processProperties = Object.fromEntries(
  ["platform", "execPath", "argv"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(process, key)!,
  ]),
);
let kill: MockInstance<typeof process.kill>;
const pid = 12345;
const entrypoint = "/opt/browse/bin/run.js";
const target = '{"kind":"managed-local","headless":true}';

function mockLinuxArgv(session: string, overrides: string[] = []) {
  vi.mocked(readFileSync).mockReturnValue(
    [
      ...(overrides.length
        ? overrides
        : ["/usr/bin/node", entrypoint, "daemon", "--session", session, "--target", target]),
      "",
    ].join("\0"),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  kill = vi.spyOn(process, "kill").mockReturnValue(true);
  Object.defineProperties(process, {
    platform: { ...processProperties.platform, value: "linux" },
    execPath: { ...processProperties.execPath, value: "/usr/bin/node" },
    argv: { ...processProperties.argv, value: ["/usr/bin/node", entrypoint] },
  });
});

afterEach(() => {
  Object.defineProperties(process, processProperties);
  vi.restoreAllMocks();
});

describe("daemon process identity", () => {
  it.each(["default", 'a session with "quotes" and --session text', "", "a\nb"])(
    "recognizes the exact Linux argv for session %j",
    (session) => {
      mockLinuxArgv(session);
      expect(isDaemonProcess(pid, session)).toBe(true);
    },
  );

  it.each(["default-other", "other-default", "default --target {}"])(
    "does not mistake session %j for default",
    (session) => {
      mockLinuxArgv(session);
      expect(isDaemonProcess(pid, "default")).toBe(false);
    },
  );

  it("does not recognize daemon/session text in another command's arguments", () => {
    mockLinuxArgv("default", [
      "/usr/bin/node",
      entrypoint,
      "open",
      "--session",
      "default",
      "--target",
      '{"url":"https://example.com/daemon"}',
    ]);
    expect(isDaemonProcess(pid, "default")).toBe(false);
  });

  it("preserves argument boundaries when identifying the command", () => {
    mockLinuxArgv("default", [
      "/usr/bin/node",
      entrypoint,
      "daemon --session default",
      "--target",
      target,
    ]);
    expect(isDaemonProcess(pid, "default")).toBe(false);
  });

  it("leaves a daemon from another installation unverified", () => {
    mockLinuxArgv("default", [
      "/usr/bin/node",
      "/opt/older-browse/bin/run.js",
      "daemon",
      "--session",
      "default",
      "--target",
      target,
    ]);
    expect(isDaemonProcess(pid, "default")).toBeNull();
  });

  it.each(["", "\0"])("does not verify an empty Linux command line", (cmdline) => {
    vi.mocked(readFileSync).mockReturnValue(cmdline);
    expect(isDaemonProcess(pid, "default")).toBeNull();
  });

  it("does not turn an unreadable command line into permission to kill", () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("Access denied"), { code: "EACCES" });
    });
    expect(isDaemonProcess(pid, "default")).toBeNull();
  });

  it("recognizes a process that exits during command-line inspection", () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("Process exited"), { code: "ENOENT" });
    });
    kill.mockReturnValueOnce(true).mockImplementationOnce(() => {
      throw Object.assign(new Error("No such process"), { code: "ESRCH" });
    });
    expect(isDaemonProcess(pid, "default")).toBe(false);
  });

  it("does not inspect a process that has exited", () => {
    kill.mockImplementation(() => {
      throw Object.assign(new Error("No such process"), { code: "ESRCH" });
    });
    expect(isDaemonProcess(pid, "default")).toBe(false);
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it.each([-1, 0, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "never signals an invalid PID %s",
    (invalidPid) => {
      expect(isDaemonProcess(invalidPid, "default")).toBe(false);
      expect(killProcess(invalidPid)).toBe(false);
      expect(kill).not.toHaveBeenCalled();
    },
  );

  describe("POSIX command inspection", () => {
    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "darwin" });
    });

    it.each(["default", 'spaces and "quotes"', "default --target {}"])(
      "recognizes the complete command for session %j",
      (session) => {
        vi.mocked(execFileSync).mockReturnValue(
          `/usr/bin/node ${entrypoint} daemon --session ${session} --target ${target}\n`,
        );
        expect(isDaemonProcess(pid, session)).toBe(true);
        expect(execFileSync).toHaveBeenCalledWith(
          "ps",
          ["-ww", "-p", String(pid), "-o", "command="],
          expect.any(Object),
        );
      },
    );

    it.each(["default-other", "default --target {}"])(
      "does not mistake session %j for default in flattened ps output",
      (session) => {
        vi.mocked(execFileSync).mockReturnValue(
          `/usr/bin/node ${entrypoint} daemon --session ${session} --target ${target}`,
        );
        expect(isDaemonProcess(pid, "default")).toBeNull();
      },
    );

    it("does not verify an unavailable ps result", () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("ps unavailable");
      });
      expect(isDaemonProcess(pid, "default")).toBeNull();
    });
  });

  describe("Windows command inspection", () => {
    beforeEach(() => {
      Object.defineProperties(process, {
        platform: { value: "win32" },
        execPath: { value: String.raw`C:\Program Files\nodejs\node.exe` },
        argv: {
          value: [
            String.raw`C:\Program Files\nodejs\node.exe`,
            String.raw`C:\Program Files\browse\bin\run.js`,
          ],
        },
      });
    });

    it("recognizes quoted installation paths", () => {
      vi.mocked(execFileSync).mockReturnValue(
        String.raw`"C:\Program Files\nodejs\node.exe" "C:\Program Files\browse\bin\run.js" daemon --session default --target "{\"kind\":\"managed-local\"}"`,
      );
      expect(isDaemonProcess(pid, "default")).toBe(true);
    });

    it("recognizes escaped session quotes and trailing backslashes", () => {
      vi.mocked(execFileSync).mockReturnValue(
        String.raw`"C:\Program Files\nodejs\node.exe" "C:\Program Files\browse\bin\run.js" daemon --session "a \"quoted\" session\\" --target "{\"kind\":\"managed-local\"}"`,
      );
      expect(isDaemonProcess(pid, 'a "quoted" session\\')).toBe(true);
    });

    it("does not mistake a quoted session containing target flags for another session", () => {
      vi.mocked(execFileSync).mockReturnValue(
        String.raw`"C:\Program Files\nodejs\node.exe" "C:\Program Files\browse\bin\run.js" daemon --session "default --target {}" --target "{\"kind\":\"managed-local\"}"`,
      );
      expect(isDaemonProcess(pid, "default")).toBeNull();
    });

    it("can inspect with WMIC when PowerShell is unavailable", () => {
      vi.mocked(execFileSync)
        .mockImplementationOnce(() => {
          throw new Error("PowerShell unavailable");
        })
        .mockReturnValueOnce(
          String.raw`CommandLine="C:\Program Files\nodejs\node.exe" "C:\Program Files\browse\bin\run.js" daemon --session default --target "{\"kind\":\"managed-local\"}"`,
        );
      expect(isDaemonProcess(pid, "default")).toBe(true);
      expect(vi.mocked(execFileSync).mock.calls[1]?.[0]).toBe("wmic");
    });

    it("does not verify a process if both inspection commands fail", () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("Inspection unavailable");
      });
      expect(isDaemonProcess(pid, "default")).toBeNull();
    });
  });
});
