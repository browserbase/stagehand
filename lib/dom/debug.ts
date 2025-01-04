export async function debugDom(chunkNumber: number = 0) {
  window.chunkNumber = chunkNumber;

  const { selectorMap } = await window.processElements(window.chunkNumber);

  drawChunk(selectorMap);
}

function drawChunk(
  selectorMap: Record<number, string[]>,
  forceDraw: boolean = false,
) {
  if (!window.showChunks && !forceDraw) return;
  cleanupMarkers();
  Object.values(selectorMap).forEach((selectorArr) => {
    let element = null;
    for (const selector of selectorArr) {
      const result = document.evaluate(
        selector,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      ).singleNodeValue as Element;

      if (result) {
        element = result;
        break;
      }
    }

    if (element) {
      let rect;
      if (element.nodeType === Node.ELEMENT_NODE) {
        rect = element.getBoundingClientRect();
      } else {
        const range = document.createRange();
        range.selectNodeContents(element);
        rect = range.getBoundingClientRect();
      }
      const color = "grey";
      const overlay = document.createElement("div");
      overlay.style.position = "absolute";
      overlay.style.left = `${rect.left + window.scrollX}px`;
      overlay.style.top = `${rect.top + window.scrollY}px`;
      overlay.style.padding = "2px"; // Add 2px of padding to the overlay

      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
      overlay.style.backgroundColor = color;
      overlay.className = "stagehand-marker";
      overlay.style.opacity = "0.3";
      overlay.style.zIndex = "1000000000"; // Ensure it's above the element
      overlay.style.border = "1px solid"; // Add a 1px solid border to the overlay
      overlay.style.pointerEvents = "none"; // Ensure the overlay does not capture mouse events
      document.body.appendChild(overlay);
    }
  });
}

async function cleanupDebug() {
  cleanupMarkers();
}

function cleanupMarkers() {
  const markers = document.querySelectorAll(".stagehand-marker");
  markers.forEach((marker) => {
    marker.remove();
  });
}

window.debugDom = debugDom;
window.cleanupDebug = cleanupDebug;
window.drawChunk = drawChunk;
