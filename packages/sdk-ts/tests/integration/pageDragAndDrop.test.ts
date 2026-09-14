import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Page, Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

const toDataUrl = (html: string): string => `data:text/html,${encodeURIComponent(html)}`;

const sharedDragFixture = toDataUrl(`<!doctype html>
  <html>
    <head>
      <style>
        body { margin: 20px; }
        #source { width: 100px; height: 100px; background: lightblue; cursor: move; }
        #target { width: 180px; height: 160px; background: lightgray; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div id="source" draggable="true">Drag me</div>
      <div id="target">Drop here</div>
      <div id="status">Waiting</div>
      <script>
        const source = document.getElementById("source");
        const target = document.getElementById("target");
        source.addEventListener("dragstart", (event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", "dragged");
        });
        target.addEventListener("dragover", (event) => event.preventDefault());
        target.addEventListener("drop", (event) => {
          event.preventDefault();
          document.getElementById("status").textContent = "Dropped";
        });
      </script>
    </body>
  </html>`);

async function dragCoordinates(
  page: Page,
  sourceSelector = "#source",
  targetSelector = "#target",
): Promise<{ fromX: number; fromY: number; toX: number; toY: number }> {
  const [source, target] = await Promise.all([
    page.locator(sourceSelector).centroid(),
    page.locator(targetSelector).centroid(),
  ]);
  return { fromX: source.x, fromY: source.y, toX: target.x, toY: target.y };
}

async function openSharedFixture(page: Page) {
  await page.goto(sharedDragFixture);
  return dragCoordinates(page);
}

describe("Page.dragAndDrop() - dragging elements", () => {
  let stagehand: Stagehand;

  beforeEach(async () => {
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
  });

  it("drags and drops element to target zone", async () => {
    const page = await firstPage(stagehand);
    const { fromX, fromY, toX, toY } = await openSharedFixture(page);

    await page.dragAndDrop(fromX, fromY, toX, toY);

    await expect.poll(() => page.locator("#status").textContent()).toBe("Dropped");
  });

  it("drag and drop with steps parameter", async () => {
    const page = await firstPage(stagehand);
    const { fromX, fromY, toX, toY } = await openSharedFixture(page);

    await page.dragAndDrop(fromX, fromY, toX, toY, { steps: 5 });

    await expect.poll(() => page.locator("#status").textContent()).toBe("Dropped");
  });

  it("drag and drop with delay between steps", async () => {
    const page = await firstPage(stagehand);
    const { fromX, fromY, toX, toY } = await openSharedFixture(page);

    await page.dragAndDrop(fromX, fromY, toX, toY, { steps: 3, delay: 50 });

    await expect.poll(() => page.locator("#status").textContent()).toBe("Dropped");
  });

  it("multiple sequential drag and drops", async () => {
    const page = await firstPage(stagehand);
    await page.goto(
      toDataUrl(`<!doctype html>
        <style>
          .item, .zone { display: inline-block; margin: 10px; }
          .item { width: 80px; height: 80px; background: lightblue; }
          .zone { width: 150px; height: 150px; background: lightyellow; }
        </style>
        <div id="item1" class="item" draggable="true">Item 1</div>
        <div id="zone1" class="zone"></div>
        <div id="item2" class="item" draggable="true">Item 2</div>
        <div id="zone2" class="zone"></div>
        <div id="log">Drops: 0</div>
        <script>
          let dropCount = 0;
          for (const id of ["item1", "item2"]) {
            document.getElementById(id).addEventListener("dragstart", (event) => {
              event.dataTransfer.effectAllowed = "move";
            });
          }
          for (const id of ["zone1", "zone2"]) {
            const zone = document.getElementById(id);
            zone.addEventListener("dragover", (event) => event.preventDefault());
            zone.addEventListener("drop", (event) => {
              event.preventDefault();
              document.getElementById("log").textContent = "Drops: " + ++dropCount;
            });
          }
        </script>`),
    );

    const first = await dragCoordinates(page, "#item1", "#zone1");
    await page.dragAndDrop(first.fromX, first.fromY, first.toX, first.toY);
    await expect.poll(() => page.locator("#log").textContent()).toBe("Drops: 1");

    const second = await dragCoordinates(page, "#item2", "#zone2");
    await page.dragAndDrop(second.fromX, second.fromY, second.toX, second.toY);
    await expect.poll(() => page.locator("#log").textContent()).toBe("Drops: 2");
  });
});
