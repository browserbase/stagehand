import { describe, expect, it } from "vite-plus/test";
import type { InitScriptSource } from "../types/private/index.js";
import { StagehandInvalidArgumentError } from "../errors.js";
import { normalizeInitScriptSource } from "./initScripts.js";

describe("init script normalization", () => {
  it("accepts inline source strings and content objects", async () => {
    await expect(normalizeInitScriptSource("globalThis.ready = true")).resolves.toBe(
      "globalThis.ready = true",
    );
    await expect(
      normalizeInitScriptSource({ content: "globalThis.fromContent = true" }),
    ).resolves.toBe("globalThis.fromContent = true");
  });

  it("serializes a function with its argument", async () => {
    const source = await normalizeInitScriptSource(
      (value: { enabled: boolean }) => {
        globalThis.console.info(value.enabled);
      },
      { enabled: true },
    );

    expect(source).toContain('({"enabled":true})');
    expect(source).toContain("value.enabled");
  });

  it("rejects filesystem path objects", async () => {
    const pathSource = { path: "./init.js" } as unknown as InitScriptSource<never>;

    await expect(normalizeInitScriptSource(pathSource)).rejects.toBeInstanceOf(
      StagehandInvalidArgumentError,
    );
    await expect(normalizeInitScriptSource(pathSource)).rejects.toThrow("object with content");
  });
});
