import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import password from "@inquirer/password";
import { readSecretValue } from "../src/lib/secrets/input.js";

vi.mock("@inquirer/password", () => ({ default: vi.fn() }));

const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
beforeEach(() => {
  vi.mocked(password).mockReset();
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  if (originalIsTTY)
    Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
  else Reflect.deleteProperty(process.stdin, "isTTY");
});

describe("interactive secret input", () => {
  it("uses a hidden prompt on stderr and preserves whitespace", async () => {
    vi.mocked(password).mockResolvedValue("  secret value  ");
    expect(Buffer.from(await readSecretValue({})).toString()).toBe(
      "  secret value  ",
    );
    expect(password).toHaveBeenCalledWith(
      { message: "Secret value:" },
      { output: process.stderr },
    );
  });

  it("reports cancellation without echoing the prompt error", async () => {
    vi.mocked(password).mockRejectedValue(new Error("private-value"));
    await expect(readSecretValue({})).rejects.toMatchObject({
      message: "Secret input cancelled.",
    });
  });
});

describe("environment secret input", () => {
  it.each(["constructor", "toString"])(
    "rejects an unset inherited environment property %s",
    async (env) => {
      vi.stubEnv(env, undefined);
      await expect(readSecretValue({ env })).rejects.toMatchObject({
        name: "CommandFailure",
        message: "The environment variable selected by --env is not set.",
      });
      expect(password).not.toHaveBeenCalled();
    },
  );

  it.each(["constructor", "toString"])(
    "reads an explicitly set environment property %s",
    async (env) => {
      vi.stubEnv(env, "private-value");
      expect(Buffer.from(await readSecretValue({ env })).toString()).toBe(
        "private-value",
      );
    },
  );

  it("preserves an explicitly empty value without prompting", async () => {
    vi.stubEnv("BROWSE_TEST_SECRET_VALUE", "");
    expect(
      await readSecretValue({ env: "BROWSE_TEST_SECRET_VALUE" }),
    ).toHaveLength(0);
    expect(password).not.toHaveBeenCalled();
  });
});
