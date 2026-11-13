import { ChildProcess } from "node:child_process";
import spawn from "cross-spawn";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { openUrl } from "../src/lib/open-url.js";

vi.mock("cross-spawn", () => ({ default: vi.fn() }));

const url = "https://example.com/community";
const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
let child: ChildProcess;
let unref: MockInstance<ChildProcess["unref"]>;

beforeEach(() => {
  vi.mocked(spawn).mockReset();
  vi.stubEnv("CI", undefined);
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: true,
  });
  child = new ChildProcess();
  unref = vi.spyOn(child, "unref").mockImplementation(() => {});
  vi.mocked(spawn).mockReturnValue(child);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (originalIsTTY) Object.defineProperty(process.stdout, "isTTY", originalIsTTY);
  else Reflect.deleteProperty(process.stdout, "isTTY");
});

describe("openUrl", () => {
  it("does not launch an opener when noOpen is set in an interactive terminal", async () => {
    expect(await openUrl(url, { noOpen: true })).toEqual({ attempted: false, success: true });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("does not launch an opener when stdout is not a TTY", async () => {
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false });

    expect(await openUrl(url)).toEqual({ attempted: false, success: true });
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each(["true", "1"])(
    "does not launch an opener in an interactive terminal with CI=%s",
    async (ci) => {
      vi.stubEnv("CI", ci);

      expect(await openUrl(url)).toEqual({ attempted: false, success: true });
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it("waits for the opener to spawn before reporting success and detaching", async () => {
    const result = openUrl(url);

    expect(spawn).toHaveBeenCalledOnce();
    expect(unref).not.toHaveBeenCalled();
    child.emit("spawn");

    await expect(result).resolves.toEqual({ attempted: true, success: true });
    expect(unref).toHaveBeenCalledOnce();
  });

  it("handles an asynchronous missing-opener error without throwing", async () => {
    const result = openUrl(url);
    const error = Object.assign(new Error("spawn opener ENOENT"), { code: "ENOENT" });

    await Promise.resolve();
    expect(() => child.emit("error", error)).not.toThrow();

    await expect(result).resolves.toEqual({ attempted: true, success: false });
    expect(unref).not.toHaveBeenCalled();
  });

  it("reports a synchronous spawn failure without throwing", async () => {
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error("Unable to spawn opener");
    });

    await expect(openUrl(url)).resolves.toEqual({ attempted: true, success: false });
  });

  it.each(["", "0", "false", "no", "off", " FALSE "])(
    "allows an opener in an interactive terminal with CI=%j",
    async (ci) => {
      vi.stubEnv("CI", ci);
      const result = openUrl(url);

      expect(spawn).toHaveBeenCalledOnce();
      child.emit("spawn");

      await expect(result).resolves.toEqual({ attempted: true, success: true });
    },
  );
});
