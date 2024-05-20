async function waitForDomSettle() {
  return new Promise((resolve) => {
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
    observer.observe(document.body, { childList: true, subtree: true });
  });
}
