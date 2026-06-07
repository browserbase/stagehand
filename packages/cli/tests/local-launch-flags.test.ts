import { afterEach, describe, expect, it } from "vitest";

import {
  resolveConnectionTarget,
  targetsCompatible,
} from "../src/lib/driver/mode.js";

describe("managed-local launch flags", () => {
  const previousChromePath = process.env.CHROME_PATH;

  afterEach(() => {
    restoreEnv("CHROME_PATH", previousChromePath);
  });

  it("attaches launch options to managed-local targets", async () => {
    await expect(
      resolveConnectionTarget({
        "chrome-arg": ["--renderer-process-limit=6"],
        "chrome-path": "/opt/chrome/chrome",
        "connect-timeout": 30_000,
        local: true,
      }),
    ).resolves.toEqual({
      headless: true,
      kind: "managed-local",
      launch: {
        args: ["--renderer-process-limit=6"],
        connectTimeoutMs: 30_000,
        executablePath: "/opt/chrome/chrome",
      },
    });
  });

  it("uses CHROME_PATH when --chrome-path is omitted", async () => {
    process.env.CHROME_PATH = "/env/chrome";
    await expect(resolveConnectionTarget({ local: true })).resolves.toEqual({
      headless: true,
      kind: "managed-local",
      launch: {
        executablePath: "/env/chrome",
      },
    });
  });

  it("rejects launch flags with remote mode", async () => {
    await expect(
      resolveConnectionTarget({
        "chrome-path": "/opt/chrome/chrome",
        remote: true,
      }),
    ).rejects.toThrow("--chrome-path cannot be combined with --remote");
  });

  it("requires matching launch options for managed-local compatibility", () => {
    expect(
      targetsCompatible(
        {
          headless: true,
          kind: "managed-local",
          launch: { executablePath: "/opt/chrome/chrome" },
        },
        {
          headless: true,
          kind: "managed-local",
          launch: { executablePath: "/opt/chrome/chrome" },
        },
      ),
    ).toBe(true);

    expect(
      targetsCompatible(
        {
          headless: true,
          kind: "managed-local",
          launch: { connectTimeoutMs: 15_000 },
        },
        {
          headless: true,
          kind: "managed-local",
          launch: { connectTimeoutMs: 30_000 },
        },
      ),
    ).toBe(false);
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
