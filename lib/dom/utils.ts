async function waitForDomSettle() {
  return new Promise<void>((resolve) => {
    const createTimeout = () => {
      return setTimeout(() => {
        resolve();
      }, 2000);
    };
    let timeout = createTimeout();
    const observer = new MutationObserver(() => {
      clearTimeout(timeout);
      timeout = createTimeout();
    });
    observer.observe(window.document.body, { childList: true, subtree: true });
  });
}

function isVisible(element: Element): boolean {
  const style = window.getComputedStyle(element);
  return (
    style &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    element.getClientRects().length > 0
  );
}

window.waitForDomSettle = waitForDomSettle;
