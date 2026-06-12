const THROTTLE_MS = 500;
const lastSent = {};

function getXPath(el) {
  if (!el || el.nodeType !== 1) return "";
  const parts = [];
  while (el && el.nodeType === 1) {
    let idx = 1;
    for (
      let sib = el.previousElementSibling;
      sib;
      sib = sib.previousElementSibling
    ) {
      if (sib.tagName === el.tagName) idx++;
    }
    parts.unshift(`${el.tagName.toLowerCase()}[${idx}]`);
    el = el.parentElement;
  }
  return "/" + parts.join("/");
}

function buildPayload(type, e) {
  const target = e.target || {};
  const payload = {
    type,
    timestamp: Date.now(),
    url: location.href,
    target: {
      tagName: target.tagName || "",
      id: target.id || "",
      className: target.className || "",
      textContent: (target.textContent || "").slice(0, 100),
      xpath: getXPath(target),
    },
  };
  if (e.clientX !== undefined) {
    payload.x = e.clientX;
    payload.y = e.clientY;
  }
  if (e.key) payload.key = e.key;
  if (target.value !== undefined)
    payload.value = String(target.value).slice(0, 200);
  if (type === "scroll") {
    payload.scrollX = window.scrollX;
    payload.scrollY = window.scrollY;
  }
  return payload;
}

function throttled(type) {
  return type === "scroll" || type === "input";
}

function send(type, e) {
  if (throttled(type)) {
    const now = Date.now();
    if (lastSent[type] && now - lastSent[type] < THROTTLE_MS) return;
    lastSent[type] = now;
  }
  chrome.runtime.sendMessage({ type: "action", data: buildPayload(type, e) });
}

["click", "keydown", "keyup", "input", "scroll", "change", "submit"].forEach(
  (evt) => {
    document.addEventListener(evt, (e) => send(evt, e), true);
  },
);

chrome.runtime.sendMessage({
  type: "action",
  data: {
    type: "pageLoad",
    timestamp: Date.now(),
    url: location.href,
    title: document.title,
  },
});
