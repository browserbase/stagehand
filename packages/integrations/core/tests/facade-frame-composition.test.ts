import { describe, expect, it, vi } from "vitest";
import { createPlaywrightCompatRuntime } from "../src/facade/runtime.js";

interface TestLocator {
  locator(selector: string): TestLocator;
  frameLocator(selector: string): TestFrame;
  contentFrame(): TestFrame;
  nth(index: number): TestLocator;
  click(options?: Record<string, unknown>): Promise<void>;
  fill(value: string): Promise<void>;
  count(): Promise<number>;
}

interface TestFrame {
  frameLocator(selector: string): TestFrame;
  locator(selector: string): TestLocator;
  getByRole(role: string, options?: Record<string, unknown>): TestLocator;
}

async function setup() {
  const clicks = vi.fn();
  const fills = vi.fn();
  const snapshot = vi.fn();
  const locator = vi.fn((selector: string) => ({
    count: async () => 1,
    click: async () => clicks(selector),
    fill: async (value: string) => fills(selector, value),
  }));
  const rawPage = {
    pageId: "page-1",
    url: async () => "https://example.test/",
    evaluate: async () => ({ width: 1280, height: 720 }),
    locator,
    snapshot,
  };
  const runtime = await createPlaywrightCompatRuntime({
    page: rawPage,
    context: { pages: async () => [rawPage] },
  } as unknown as Parameters<typeof createPlaywrightCompatRuntime>[0]);
  const page = runtime.page as { frameLocator(selector: string): TestFrame };
  return { page, clicks, fills, locator, snapshot };
}

describe("facade frame locator composition", () => {
  it("keeps existing frame hops when locating a descendant iframe", async () => {
    const { page, fills } = await setup();
    await page
      .frameLocator("#outer")
      .frameLocator("#middle")
      .locator("section")
      .locator(".payment, .backup")
      .frameLocator("iframe.card, iframe.fallback")
      .locator("input[name=cardholder]")
      .fill("Example");

    expect(fills).toHaveBeenCalledExactlyOnceWith(
      "#outer >> #middle >> :is(section) :is(.payment, .backup) :is(iframe.card, iframe.fallback) >> input[name=cardholder]",
      "Example",
    );
  });

  it("enters an iframe element without adding an extra frame hop", async () => {
    const { page, clicks } = await setup();
    await page
      .frameLocator("#outer")
      .locator(".payment")
      .locator("iframe")
      .contentFrame()
      .locator("button.confirm")
      .click();

    expect(clicks).toHaveBeenCalledExactlyOnceWith(
      "#outer >> :is(.payment) :is(iframe) >> button.confirm",
    );
  });

  it("rejects an indexed frame owner instead of losing its index", async () => {
    const { page, locator } = await setup();
    expect(() => page.frameLocator("#outer").locator("iframe").nth(1).contentFrame()).toThrow(
      /frame owners must use css selectors without an index/u,
    );
    expect(locator).not.toHaveBeenCalled();
  });

  it("never dispatches a trial click", async () => {
    const { page, clicks, locator } = await setup();
    await expect(
      page.frameLocator("#checkout").locator("button.confirm").click({ trial: true }),
    ).rejects.toThrow(/trial clicks require actionability checks/u);
    expect(clicks).not.toHaveBeenCalled();
    expect(locator).not.toHaveBeenCalled();
  });

  it("rejects nested semantic lookup instead of matching another child frame", async () => {
    const { page, snapshot } = await setup();
    await expect(
      page
        .frameLocator("#outer")
        .frameLocator("#checkout")
        .getByRole("button", { name: "Continue" })
        .count(),
    ).rejects.toThrow(/nested frame semantic queries are not supported/u);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it.each(["checked", "disabled", "selected", "expanded", "pressed", "includeHidden", "level"])(
    "does not silently discard the %s role filter",
    async (name) => {
      const { page, locator } = await setup();
      expect(() =>
        page
          .frameLocator("#checkout")
          .getByRole("checkbox", { [name]: name === "level" ? 2 : false }),
      ).toThrow(`the ${name} filter cannot be resolved`);
      expect(locator).not.toHaveBeenCalled();
    },
  );
});
