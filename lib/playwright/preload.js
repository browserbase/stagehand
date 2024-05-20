async function waitForDomSettle() {
  return new Promise((resolve) => {
    const createTimeout = () => {
      return setTimeout(() => {
        resolve();
        console.log("settled!");
      }, 2000);
    };
    let timeout = createTimeout();
    const observer = new MutationObserver(() => {
      clearTimeout(timeout);
      console.log("moving!");
      timeout = createTimeout();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}
