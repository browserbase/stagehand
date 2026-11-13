import { ChildProcess } from "node:child_process";
import open from "open";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openUrl } from "../src/lib/open-url.js";

vi.mock("open", () => ({ default: vi.fn() }));

const url = "https://example.com/community";
const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

beforeEach(() => {
  vi.mocked(open).mockReset();
  vi.stubEnv("CI", undefined);
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: true,
  });
  vi.mocked(open).mockResolvedValue(new ChildProcess());
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
    expect(open).not.toHaveBeenCalled();
  });

  it("does not launch an opener when stdout is not a TTY", async () => {
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false });

    expect(await openUrl(url)).toEqual({ attempted: false, success: true });
    expect(open).not.toHaveBeenCalled();
  });

  it.each(["true", "1", "0", "no", "off", " FALSE "])(
    "does not launch an opener in an interactive terminal with CI=%s",
    async (ci) => {
      vi.stubEnv("CI", ci);

      expect(await openUrl(url)).toEqual({ attempted: false, success: true });
      expect(open).not.toHaveBeenCalled();
    },
  );

  it("waits for the opener before reporting success", async () => {
    let resolveOpen!: (child: ChildProcess) => void;
    vi.mocked(open).mockReturnValue(
      new Promise((resolve) => {
        resolveOpen = resolve;
      }),
    );
    const onResult = vi.fn();
    const result = openUrl(url).then(onResult);

    await Promise.resolve();
    expect(open).toHaveBeenCalledExactlyOnceWith(url);
    expect(onResult).not.toHaveBeenCalled();
    resolveOpen(new ChildProcess());
    await result;

    expect(onResult).toHaveBeenCalledWith({ attempted: true, success: true });
  });

  it("handles a rejected opener without throwing", async () => {
    vi.mocked(open).mockRejectedValue(
      Object.assign(new Error("spawn opener ENOENT"), { code: "ENOENT" }),
    );

    await expect(openUrl(url)).resolves.toEqual({ attempted: true, success: false });
  });

  it("reports a synchronous opener failure without throwing", async () => {
    vi.mocked(open).mockImplementation(() => {
      throw new Error("Unable to open URL");
    });

    await expect(openUrl(url)).resolves.toEqual({ attempted: true, success: false });
  });

  it.each(["", "false"])("allows an opener with CI=%j", async (ci) => {
    vi.stubEnv("CI", ci);

    expect(await openUrl(url)).toEqual({ attempted: true, success: true });
    expect(open).toHaveBeenCalledExactlyOnceWith(url);
  });
});
