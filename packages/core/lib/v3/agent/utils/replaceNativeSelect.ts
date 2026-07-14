/**
 * Minimal native `<select>` dropdown shim for computer-use agents.
 *
 * A native `<select>`'s option list is a browser/OS control, not regular DOM,
 * so a CUA agent's coordinate clicks don't register as selections — it just
 * re-clicks the control and the value never changes. This injects an in-page
 * HTML overlay listbox over native selects: on mousedown we suppress the native
 * dropdown and render the options as real, clickable DOM; choosing one sets the
 * underlying `<select>.value` via the native setter (so framework-controlled
 * selects accept it) and fires input/change so the page reacts. The overlay
 * closes on an outside click or a second click on the control.
 *
 * The CUA screenshot provider injects this before every screenshot. Re-injecting
 * is idempotent: bound selects are tracked in a `window` WeakSet (bound once),
 * the overlay is resolved by id and only (re)created when missing, and the
 * outside-click listener is bound once per document. So re-injection never
 * accumulates handlers, never rebuilds an already-open overlay, and — because
 * the overlay is always looked up by id rather than a captured reference — a
 * select bound on an earlier step keeps working even if the page tears the
 * overlay down (e.g. an SPA re-render). Options are positioned within the
 * viewport (flipping above the control when there isn't room below) so they stay
 * visible in the screenshot. Single-select only (multi-selects skipped);
 * disabled options are greyed and non-clickable; hidden selects are left alone
 * until visible.
 */
export const REPLACE_NATIVE_SELECT_SCRIPT = `(() => {
  const W = window;
  const OVERLAY_ID = "__sh-select-overlay";
  if (!W.__shSelectHandled) W.__shSelectHandled = new WeakSet();
  const handled = W.__shSelectHandled;

  // Native value setter so framework-controlled (React/Vue) <select>s accept the
  // change instead of snapping back to their internal state value.
  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  const nativeSet = desc && desc.set;

  // Always resolve (and lazily re-create) the overlay by id, so a <select> bound
  // on an earlier step never points at a stale/detached element if the page tore
  // the overlay down — the dropdown keeps working across re-renders.
  const ensureOverlay = () => {
    let o = document.getElementById(OVERLAY_ID);
    if (!o) {
      o = document.createElement("div");
      o.id = OVERLAY_ID;
      o.style.cssText =
        "position:absolute;z-index:2147483646;display:none;background:#fff;" +
        "border:1px solid #999;overflow:auto;font:14px sans-serif;" +
        "box-shadow:0 2px 8px rgba(0,0,0,.3);min-width:80px;";
      document.body.appendChild(o);
    }
    return o;
  };
  ensureOverlay();

  const hide = () => {
    const o = document.getElementById(OVERLAY_ID);
    if (o) o.style.display = "none";
    W.__shSelectActive = null;
  };

  const show = (select) => {
    const overlay = ensureOverlay();
    W.__shSelectActive = select;
    overlay.innerHTML = "";
    Array.from(select.options).forEach((opt) => {
      const row = document.createElement("div");
      row.textContent = opt.label;
      row.style.cssText = "padding:8px 12px;white-space:nowrap;" +
        (opt.disabled ? "color:#aaa;cursor:default;" : "cursor:pointer;") +
        (opt.selected ? "background:#e6f0ff;" : "");
      if (!opt.disabled) {
        row.addEventListener("mouseover", () => { row.style.background = "#f0f0f0"; });
        row.addEventListener("mouseout", () => {
          row.style.background = opt.selected ? "#e6f0ff" : "#fff";
        });
        row.addEventListener("mousedown", (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (nativeSet) nativeSet.call(select, opt.value); else select.value = opt.value;
          select.dispatchEvent(new Event("input", { bubbles: true }));
          select.dispatchEvent(new Event("change", { bubbles: true }));
          hide();
        });
      }
      overlay.appendChild(row);
    });

    // Place below the control, or above when there isn't room, capping the
    // height to the viewport so the options stay visible in the screenshot.
    const r = select.getBoundingClientRect();
    const margin = 8;
    overlay.style.minWidth = r.width + "px";
    overlay.style.maxHeight = "none";
    overlay.style.visibility = "hidden";
    overlay.style.display = "block";
    const needed = overlay.scrollHeight;
    const below = W.innerHeight - r.bottom - margin;
    const above = r.top - margin;
    const placeBelow = below >= needed || below >= above;
    overlay.style.maxHeight = Math.max(60, placeBelow ? below : above) + "px";
    overlay.style.left = r.left + W.scrollX + "px";
    overlay.style.top =
      (placeBelow ? r.bottom : r.top - Math.min(needed, above)) + W.scrollY + "px";
    overlay.style.visibility = "visible";
  };

  const isHidden = (el) => {
    const s = W.getComputedStyle(el);
    return s.display === "none" || s.visibility === "hidden";
  };

  const selects = [];
  document.querySelectorAll("select").forEach((s) => selects.push(s));
  document.querySelectorAll("*").forEach((el) => {
    if (el.shadowRoot) el.shadowRoot.querySelectorAll("select").forEach((s) => selects.push(s));
  });
  for (const select of selects) {
    if (select.hasAttribute("multiple") || handled.has(select)) continue;
    if (isHidden(select)) continue; // leave it alone; bind once it becomes visible
    handled.add(select);
    select.addEventListener("mousedown", (e) => {
      if (e.defaultPrevented) return;
      e.preventDefault();
      const o = document.getElementById(OVERLAY_ID);
      if (o && o.style.display === "block" && W.__shSelectActive === select) hide();
      else show(select);
    });
  }

  // Close on an outside click. Bound once per document (survives overlay
  // re-creation because it resolves the overlay by id at event time).
  if (!W.__shSelectDocBound) {
    W.__shSelectDocBound = true;
    document.addEventListener("mousedown", (e) => {
      const o = document.getElementById(OVERLAY_ID);
      if (W.__shSelectActive && e.target !== W.__shSelectActive && (!o || !o.contains(e.target))) {
        hide();
      }
    });
  }
})();`;
