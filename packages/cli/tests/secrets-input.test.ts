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
    await expect(readSecretValue({})).rejects.toThrow(
      "Secret input cancelled.",
    );
  });
});
