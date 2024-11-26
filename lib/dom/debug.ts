export async function debugDom() {
  window.chunkNumber = 0;

  const { selectorMap: multiSelectorMap, outputString } =
    await window.processElements(window.chunkNumber);

  const selectorMap = multiSelectorMapToSelectorMap(multiSelectorMap);

  drawChunk(selectorMap);
  setupChunkNav();
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
  Object.entries(selectorMap).forEach(([_index, selector]) => {
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
  cleanupNav();
}

function cleanupMarkers() {
  const markers = document.querySelectorAll(".stagehand-marker");
  markers.forEach((marker) => {
    marker.remove();
  });
}

function cleanupNav() {
  const stagehandNavElements = document.querySelectorAll(".stagehand-nav");
  stagehandNavElements.forEach((element) => {
    element.remove();
  });
}

function setupChunkNav() {
  const viewportHeight = window.innerHeight;
  const documentHeight = document.documentElement.scrollHeight;
  const totalChunks = Math.ceil(documentHeight / viewportHeight);

  if (window.chunkNumber > 0) {
    const prevChunkButton = document.createElement("button");
    prevChunkButton.className = "stagehand-nav";

    prevChunkButton.textContent = "Previous";
    prevChunkButton.style.marginLeft = "50px";
    prevChunkButton.style.position = "fixed";
    prevChunkButton.style.bottom = "10px";
    prevChunkButton.style.left = "50%";
    prevChunkButton.style.transform = "translateX(-50%)";
    prevChunkButton.style.zIndex = "1000000000";
    prevChunkButton.onclick = async () => {
      cleanupMarkers();
      cleanupNav();
      window.chunkNumber -= 1;
      window.scrollTo(0, window.chunkNumber * window.innerHeight);
      await window.waitForDomSettle();
      const { selectorMap: multiSelectorMap } = await window.processElements(
        window.chunkNumber,
      );

      const selectorMap = multiSelectorMapToSelectorMap(multiSelectorMap);

      drawChunk(selectorMap);
      setupChunkNav();
    };
    document.body.appendChild(prevChunkButton);
  }
  if (totalChunks > window.chunkNumber) {
    const nextChunkButton = document.createElement("button");
    nextChunkButton.className = "stagehand-nav";
    nextChunkButton.textContent = "Next";
    nextChunkButton.style.marginRight = "50px";
    nextChunkButton.style.position = "fixed";
    nextChunkButton.style.bottom = "10px";
    nextChunkButton.style.right = "50%";
    nextChunkButton.style.transform = "translateX(50%)";
    nextChunkButton.style.zIndex = "1000000000";
    nextChunkButton.onclick = async () => {
      cleanupMarkers();
      cleanupNav();
      window.chunkNumber += 1;
      window.scrollTo(0, window.chunkNumber * window.innerHeight);
      await window.waitForDomSettle();

      const { selectorMap: multiSelectorMap } = await window.processElements(
        window.chunkNumber,
      );
      const selectorMap = multiSelectorMapToSelectorMap(multiSelectorMap);
      drawChunk(selectorMap);
      setupChunkNav();
    };

    document.body.appendChild(nextChunkButton);
  }
}

window.debugDom = debugDom;
window.cleanupDebug = cleanupDebug;
