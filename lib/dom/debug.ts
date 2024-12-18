export async function debugDom() {
  window.chunkNumber = 0;

  const { selectorMap: multiSelectorMap } = await window.processElements(
    window.chunkNumber,
  );

  const selectorMap = multiSelectorMapToSelectorMap(multiSelectorMap);

  drawChunk(selectorMap);
}

function multiSelectorMapToSelectorMap(
  multiSelectorMap: Record<number, string[]>,
) {
  return Object.fromEntries(
    Object.entries(multiSelectorMap).map(([key, selectors]) => [
      Number(key),
      selectors[0],
    ]),
  );
}

function drawChunk(selectorMap: Record<number, string>) {
  if (!window.showChunks) return;
  cleanupMarkers();
  Object.values(selectorMap).forEach((selector) => {
    const element = document.evaluate(
      selector as string,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue as Element;

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
