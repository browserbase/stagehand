import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("core fixtures", () => {
  it("falls back to inline fixtures in Browserbase when no local fixture server exists", async () => {
    process.env.EVAL_ENV = "browserbase";
    vi.resetModules();

    const { dropdownFixture, resistorFixture } = await import(
      "../../core/fixtures/index.js"
    );

    expect(dropdownFixture.url).toMatch(/^data:text\/html/);
    expect(resistorFixture.url).toMatch(/^data:text\/html/);
  });

  it("falls back to inline fixtures when no local fixture server is running", async () => {
    process.env.EVAL_ENV = "local";
    vi.resetModules();

    const { dropdownFixture } = await import("../../core/fixtures/index.js");

    expect(dropdownFixture.url).toMatch(/^data:text\/html/);
  });
});
