import { describe, expect, it, vi } from "vitest";
import { createPlaywrightCompatRuntime } from "../src/facade/runtime.js";

type CompatMouse = {
  move(x: number, y: number, options?: { steps?: number }): Promise<void>;
  down(options?: { button?: "left" | "right" | "middle" }): Promise<void>;
  up(): Promise<void>;
};

async function fixture() {
  const rawPage = {
    pageId: "test-page",
    url: vi.fn(async () => "https://example.com/"),
    evaluate: vi.fn(async () => ({ width: 800, height: 600 })),
    click: vi.fn(async () => {}),
    hover: vi.fn(async () => {}),
    dragAndDrop: vi.fn(async () => {}),
  };
  const rawContext = { pages: vi.fn(async () => [rawPage]) };
  // Exercise the same self-contained serialization boundary as callback batches.
  const create = new Function(
    `return (${createPlaywrightCompatRuntime.toString()})`,
  )() as typeof createPlaywrightCompatRuntime;
  const runtime = await create({ page: rawPage, context: rawContext } as unknown as Parameters<
    typeof createPlaywrightCompatRuntime
  >[0]);
  return { mouse: (runtime.page as { mouse: CompatMouse }).mouse, rawPage };
}

describe("facade page.mouse", () => {
  it("performs one drag from the press point through the held moves", async () => {
    const { mouse, rawPage } = await fixture();
    await mouse.move(10, 20);
    await mouse.down({ button: "right" });
    await mouse.move(30, 40);
    await mouse.move(50, 60, { steps: 4 });
    await mouse.up();
    expect(rawPage.dragAndDrop.mock.calls).toStrictEqual([
      [
        10,
        20,
        50,
        60,
        {
          button: "right",
          route: [
            { x: 30, y: 40 },
            { x: 35, y: 45 },
            { x: 40, y: 50 },
            { x: 45, y: 55 },
          ],
        },
      ],
    ]);
    expect(rawPage.click).not.toHaveBeenCalled();
    expect(rawPage.hover.mock.calls).toStrictEqual([[10, 20]]);
  });

  it("interpolates a single stepped held move into the route", async () => {
    const { mouse, rawPage } = await fixture();
    await mouse.move(0, 0);
    await mouse.down();
    await mouse.move(30, 60, { steps: 3 });
    await mouse.up();
    expect(rawPage.dragAndDrop.mock.calls).toStrictEqual([
      [
        0,
        0,
        30,
        60,
        {
          button: "left",
          route: [
            { x: 10, y: 20 },
            { x: 20, y: 40 },
          ],
        },
      ],
    ]);
  });

  it("drags straight to the release point after a single held move", async () => {
    const { mouse, rawPage } = await fixture();
    await mouse.move(10, 20);
    await mouse.down();
    await mouse.move(50, 60);
    await mouse.up();
    expect(rawPage.dragAndDrop.mock.calls).toStrictEqual([
      [10, 20, 50, 60, { button: "left", steps: 8 }],
    ]);
  });

  it("clicks when the button is released without moving", async () => {
    const { mouse, rawPage } = await fixture();
    await mouse.move(10, 20);
    await mouse.down();
    await mouse.up();
    expect(rawPage.click.mock.calls).toStrictEqual([[10, 20, undefined]]);
    expect(rawPage.dragAndDrop).not.toHaveBeenCalled();
  });

  it("hovers on moves while no button is held", async () => {
    const { mouse, rawPage } = await fixture();
    await mouse.move(10, 20);
    await mouse.move(30, 40);
    await mouse.up();
    expect(rawPage.hover.mock.calls).toStrictEqual([
      [10, 20],
      [30, 40],
    ]);
    expect(rawPage.click).not.toHaveBeenCalled();
    expect(rawPage.dragAndDrop).not.toHaveBeenCalled();
  });
});
