export async function debugDom(chunkNumber: number = 0) {
  window.chunkNumber = chunkNumber;

  const { selectorMap } = await window.processElements(window.chunkNumber);

  drawChunk(selectorMap);
}

function findElementWithIframeSupport(xpath: string | string[]): Element {
  const selectorArray = !Array.isArray(xpath) ? [xpath] : xpath;

  let currentDoc = document;
  let currentElement = null;

  for (const [index, selector] of selectorArray.entries()) {
    const result = document.evaluate(
      selector,
      currentDoc,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue as Element;

    if (!result) {
      throw new Error("Element not found");
    }

    if (result instanceof HTMLIFrameElement) {
      currentDoc = result.contentDocument;
    } else if (index === selectorArray.length - 1) {
      currentElement = result;
    } else {
      throw new Error("Element is not an iframe or last selector");
    }
  }

  return currentElement;
}

function drawChunk(
  selectorMap: Record<number, (string | string[])[]>,
  forceDraw: boolean = false,
) {
  if (!window.showChunks && !forceDraw) return;
  cleanupMarkers();
  Object.values(selectorMap).forEach((selectorArr) => {
    let element = null;
    for (const selector of selectorArr) {
      try {
        element = findElementWithIframeSupport(selector);
        if (!element) {
          throw new Error("Element not found");
        }
        break;
      } catch (e) {
        console.error("Error finding element using selector", e, selectorArr);
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

      let totalOffsetX = window.scrollX;
      let totalOffsetY = window.scrollY;
      let currentWindow: Window = element.ownerDocument.defaultView;

      while (currentWindow !== window.top) {
        const frameElement = currentWindow.frameElement;
        if (frameElement) {
          const frameRect = frameElement.getBoundingClientRect();
          totalOffsetX += frameRect.left;
          totalOffsetY += frameRect.top;
        }
        currentWindow = currentWindow.parent;
      }

      const color = "grey";
      const overlay = document.createElement("div");
      overlay.style.position = "absolute";
      overlay.style.left = `${rect.left + totalOffsetX}px`;
      overlay.style.top = `${rect.top + totalOffsetY}px`;
      overlay.style.padding = "2px"; // Add 2px of padding to the overlay

      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
      overlay.style.backgroundColor = color;
      overlay.className = "stagehand-marker";
      overlay.style.opacity = "0.3";
      overlay.style.zIndex = "10000000000000"; // Ensure it's above the element
      overlay.style.border = "1px solid"; // Add a 1px solid border to the overlay
      overlay.style.pointerEvents = "none"; // Ensure the overlay does not capture mouse events
      document.body.appendChild(overlay);
    } else {
      console.error("Could not find a valid selector for element");
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
window.findElementWithIframeSupport = findElementWithIframeSupport;
