import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";

test.describe("Page.dragAndDrop() - dragging elements", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("drags and drops element to target zone", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(`
          <!doctype html>
          <html>
          <head>
            <style>
              body { font-family: Arial; margin: 0; padding: 20px; }
              .container { display: flex; gap: 20px; }
              .source-box {
                width: 150px;
                height: 100px;
                background: lightblue;
                border: 2px solid blue;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: move;
                user-select: none;
              }
              .drop-zone {
                width: 200px;
                height: 150px;
                background: lightyellow;
                border: 2px dashed orange;
                display: flex;
                align-items: center;
                justify-content: center;
              }
              .result { margin-top: 20px; font-weight: bold; }
            </style>
          </head>
          <body>
            <div class="container">
              <div id="source" class="source-box" draggable="true">Drag Me</div>
              <div id="dropZone" class="drop-zone">Drop Here</div>
            </div>
            <div id="result" class="result">Status: Waiting</div>
            <script>
              const source = document.getElementById('source');
              const dropZone = document.getElementById('dropZone');
              const result = document.getElementById('result');
              
              source.addEventListener('dragstart', (e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', 'Dragged Element');
              });
              
              dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                dropZone.style.background = 'lightgreen';
              });
              
              dropZone.addEventListener('dragleave', () => {
                dropZone.style.background = 'lightyellow';
              });
              
              dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                result.textContent = 'Status: DROP SUCCESSFUL';
                result.style.color = 'green';
                dropZone.style.background = 'lightgreen';
              });
            </script>
          </body>
          </html>
        `),
    );

    // Get coordinates for drag and drop
    const sourceLocation = await page
      .frames()[0]
      .getLocationForSelector("#source");
    const dropZoneLocation = await page
      .frames()[0]
      .getLocationForSelector("#dropZone");

    const fromX = sourceLocation.x + sourceLocation.width / 2;
    const fromY = sourceLocation.y + sourceLocation.height / 2;
    const toX = dropZoneLocation.x + dropZoneLocation.width / 2;
    const toY = dropZoneLocation.y + dropZoneLocation.height / 2;

    // Perform drag and drop
    await page.dragAndDrop(fromX, fromY, toX, toY);

    // Wait for events to be processed
    await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));

    // Verify visual result
    const resultText = await page.evaluate(
      () => document.getElementById("result").textContent,
    );
    expect(resultText).toContain("DROP SUCCESSFUL");
  });

  test("drag and drop with steps parameter", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(`
          <!doctype html>
          <html>
          <head>
            <style>
              body { margin: 0; padding: 20px; }
              .box {
                width: 100px;
                height: 100px;
                background: lightblue;
                margin: 20px;
                cursor: move;
              }
              .target {
                width: 200px;
                height: 200px;
                background: lightyellow;
                margin: 20px;
                border: 2px dashed orange;
              }
            </style>
          </head>
          <body>
            <div id="box" class="box" draggable="true"></div>
            <div id="target" class="target"></div>
            <div id="status">Not dropped</div>
            <script>
              document.getElementById('box').addEventListener('dragstart', (e) => {
                e.dataTransfer.effectAllowed = 'move';
              });
              document.getElementById('target').addEventListener('drop', (e) => {
                e.preventDefault();
                document.getElementById('status').textContent = 'Dropped with steps';
              });
              document.getElementById('target').addEventListener('dragover', (e) => {
                e.preventDefault();
              });
            </script>
          </body>
          </html>
        `),
    );

    const boxLocation = await page.frames()[0].getLocationForSelector("#box");
    const targetLocation = await page
      .frames()[0]
      .getLocationForSelector("#target");

    const fromX = boxLocation.x + boxLocation.width / 2;
    const fromY = boxLocation.y + boxLocation.height / 2;
    const toX = targetLocation.x + targetLocation.width / 2;
    const toY = targetLocation.y + targetLocation.height / 2;

    // Drag with multiple steps for smoother motion
    await page.dragAndDrop(fromX, fromY, toX, toY, { steps: 5 });

    // Wait for events to be processed
    await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));

    const status = await page.evaluate(
      () => document.getElementById("status").textContent,
    );
    expect(status).toContain("Dropped");
  });

  test("drag and drop with delay between steps", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(`
          <!doctype html>
          <html>
          <head>
            <style>
              body { margin: 0; padding: 20px; }
              #dragItem { width: 80px; height: 80px; background: lightcoral; cursor: move; }
              #dropArea { width: 150px; height: 150px; background: lightgray; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div id="dragItem" draggable="true"></div>
            <div id="dropArea"></div>
            <div id="complete">false</div>
            <script>
              const item = document.getElementById('dragItem');
              const area = document.getElementById('dropArea');
              const complete = document.getElementById('complete');
              
              item.addEventListener('dragstart', (e) => {
                e.dataTransfer.effectAllowed = 'move';
              });
              
              area.addEventListener('drop', (e) => {
                e.preventDefault();
                complete.textContent = 'true';
              });
              
              area.addEventListener('dragover', (e) => {
                e.preventDefault();
              });
            </script>
          </body>
          </html>
        `),
    );

    const itemLocation = await page
      .frames()[0]
      .getLocationForSelector("#dragItem");
    const areaLocation = await page
      .frames()[0]
      .getLocationForSelector("#dropArea");

    const fromX = itemLocation.x + itemLocation.width / 2;
    const fromY = itemLocation.y + itemLocation.height / 2;
    const toX = areaLocation.x + areaLocation.width / 2;
    const toY = areaLocation.y + areaLocation.height / 2;

    // Drag with delay between steps
    await page.dragAndDrop(fromX, fromY, toX, toY, { steps: 3, delay: 50 });

    // Wait for events to be processed
    await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));

    const isComplete = await page.evaluate(
      () => document.getElementById("complete").textContent === "true",
    );
    expect(isComplete).toBe(true);
  });

  test("drag and drop returns xpath when requested", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(`
          <!doctype html>
          <html>
          <head>
            <style>
              body { margin: 20px; }
              #source { width: 100px; height: 100px; background: blue; cursor: move; }
              #target { width: 150px; height: 150px; background: green; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div id="source" draggable="true"></div>
            <div id="target"></div>
            <script>
              document.getElementById('source').addEventListener('dragstart', (e) => {
                e.dataTransfer.effectAllowed = 'move';
              });
              document.getElementById('target').addEventListener('drop', (e) => {
                e.preventDefault();
              });
              document.getElementById('target').addEventListener('dragover', (e) => {
                e.preventDefault();
              });
            </script>
          </body>
          </html>
        `),
    );

    const sourceLocation = await page
      .frames()[0]
      .getLocationForSelector("#source");
    const targetLocation = await page
      .frames()[0]
      .getLocationForSelector("#target");

    const fromX = sourceLocation.x + sourceLocation.width / 2;
    const fromY = sourceLocation.y + sourceLocation.height / 2;
    const toX = targetLocation.x + targetLocation.width / 2;
    const toY = targetLocation.y + targetLocation.height / 2;

    const [fromXpath, toXpath] = await page.dragAndDrop(
      fromX,
      fromY,
      toX,
      toY,
      {
        returnXpath: true,
      },
    );

    // Should return xpaths for both start and end positions
    expect(typeof fromXpath).toBe("string");
    expect(typeof toXpath).toBe("string");
    expect(fromXpath.length).toBeGreaterThan(0);
    expect(toXpath.length).toBeGreaterThan(0);
  });

  test("drag and drop without returnXpath returns empty strings", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(`
          <!doctype html>
          <html>
          <head>
            <style>
              body { margin: 20px; }
              #item1 { width: 80px; height: 80px; background: red; cursor: move; }
              #item2 { width: 100px; height: 100px; background: yellow; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div id="item1" draggable="true"></div>
            <div id="item2"></div>
            <script>
              document.getElementById('item1').addEventListener('dragstart', (e) => {
                e.dataTransfer.effectAllowed = 'move';
              });
              document.getElementById('item2').addEventListener('drop', (e) => {
                e.preventDefault();
              });
              document.getElementById('item2').addEventListener('dragover', (e) => {
                e.preventDefault();
              });
            </script>
          </body>
          </html>
        `),
    );

    const item1Location = await page
      .frames()[0]
      .getLocationForSelector("#item1");
    const item2Location = await page
      .frames()[0]
      .getLocationForSelector("#item2");

    const fromX = item1Location.x + item1Location.width / 2;
    const fromY = item1Location.y + item1Location.height / 2;
    const toX = item2Location.x + item2Location.width / 2;
    const toY = item2Location.y + item2Location.height / 2;

    const [fromXpath, toXpath] = await page.dragAndDrop(fromX, fromY, toX, toY);

    // Should return empty strings when returnXpath is not set
    expect(fromXpath).toBe("");
    expect(toXpath).toBe("");
  });

  test("drag and drop with different mouse buttons", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(`
          <!doctype html>
          <html>
          <head>
            <style>
              body { margin: 20px; }
              .draggable { width: 100px; height: 100px; background: lightblue; cursor: move; }
              .drop-area { width: 200px; height: 200px; background: lightgray; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div id="source" class="draggable" draggable="true"></div>
            <div id="target" class="drop-area"></div>
            <div id="buttonUsed">none</div>
            <script>
              document.getElementById('source').addEventListener('dragstart', (e) => {
                e.dataTransfer.effectAllowed = 'move';
              });
              document.getElementById('target').addEventListener('drop', (e) => {
                e.preventDefault();
                document.getElementById('buttonUsed').textContent = 'left';
              });
              document.getElementById('target').addEventListener('dragover', (e) => {
                e.preventDefault();
              });
            </script>
          </body>
          </html>
        `),
    );

    const sourceLocation = await page
      .frames()[0]
      .getLocationForSelector("#source");
    const targetLocation = await page
      .frames()[0]
      .getLocationForSelector("#target");

    const fromX = sourceLocation.x + sourceLocation.width / 2;
    const fromY = sourceLocation.y + sourceLocation.height / 2;
    const toX = targetLocation.x + targetLocation.width / 2;
    const toY = targetLocation.y + targetLocation.height / 2;

    // Test with left button (default)
    await page.dragAndDrop(fromX, fromY, toX, toY, { button: "left" });

    // Wait for events to be processed
    await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));

    const buttonUsed = await page.evaluate(
      () => document.getElementById("buttonUsed").textContent,
    );
    expect(buttonUsed).toBe("left");
  });

  test("multiple sequential drag and drops", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(`
          <!doctype html>
          <html>
          <head>
            <style>
              body { margin: 20px; font-family: Arial; }
              .item { width: 80px; height: 80px; background: lightblue; margin: 10px; cursor: move; display: inline-block; }
              .zone { width: 150px; height: 150px; background: lightyellow; margin: 10px; display: inline-block; border: 2px dashed orange; }
              #log { margin-top: 20px; }
            </style>
          </head>
          <body>
            <div id="item1" class="item" draggable="true">Item 1</div>
            <div id="zone1" class="zone"></div>
            <div id="item2" class="item" draggable="true">Item 2</div>
            <div id="zone2" class="zone"></div>
            <div id="log">Drops: 0</div>
            <script>
              let dropCount = 0;
              const items = ['item1', 'item2'];
              const zones = ['zone1', 'zone2'];
              
              items.forEach(id => {
                document.getElementById(id).addEventListener('dragstart', (e) => {
                  e.dataTransfer.effectAllowed = 'move';
                });
              });
              
              zones.forEach(id => {
                const zone = document.getElementById(id);
                zone.addEventListener('drop', (e) => {
                  e.preventDefault();
                  dropCount++;
                  document.getElementById('log').textContent = 'Drops: ' + dropCount;
                });
                zone.addEventListener('dragover', (e) => {
                  e.preventDefault();
                });
              });
            </script>
          </body>
          </html>
        `),
    );

    const item1Location = await page
      .frames()[0]
      .getLocationForSelector("#item1");
    const zone1Location = await page
      .frames()[0]
      .getLocationForSelector("#zone1");

    const from1X = item1Location.x + item1Location.width / 2;
    const from1Y = item1Location.y + item1Location.height / 2;
    const to1X = zone1Location.x + zone1Location.width / 2;
    const to1Y = zone1Location.y + zone1Location.height / 2;

    await page.dragAndDrop(from1X, from1Y, to1X, to1Y);

    await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));

    let dropCountText = await page.evaluate(
      () => document.getElementById("log").textContent,
    );
    expect(dropCountText).toContain("Drops: 1");

    const item2Location = await page
      .frames()[0]
      .getLocationForSelector("#item2");
    const zone2Location = await page
      .frames()[0]
      .getLocationForSelector("#zone2");

    const from2X = item2Location.x + item2Location.width / 2;
    const from2Y = item2Location.y + item2Location.height / 2;
    const to2X = zone2Location.x + zone2Location.width / 2;
    const to2Y = zone2Location.y + zone2Location.height / 2;

    await page.dragAndDrop(from2X, from2Y, to2X, to2Y);

    // Wait for events to be processed
    await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));

    dropCountText = await page.evaluate(
      () => document.getElementById("log").textContent,
    );
    expect(dropCountText).toContain("Drops: 2");
  });
});
