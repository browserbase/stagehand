// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPLACE_NATIVE_SELECT_SCRIPT } from "../../lib/v3/agent/utils/replaceNativeSelect.js";

// Execute the injected shim against the current jsdom document, exactly as the
// CUA screenshot provider does via page.evaluate().
function inject(): void {
  // eslint-disable-next-line no-eval
  (0, eval)(REPLACE_NATIVE_SELECT_SCRIPT);
}

function mousedown(el: Element): void {
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
}

const overlay = () => document.getElementById("__sh-select-overlay");
const rows = () => Array.from(overlay()!.querySelectorAll("div"));

describe("REPLACE_NATIVE_SELECT_SCRIPT", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    overlay()?.remove();
    const w = window as unknown as Record<string, unknown>;
    delete w.__shSelectHandled;
    delete w.__shSelectActive;
    delete w.__shSelectShadowUrl;
  });

  it("opens an overlay and selecting an option sets the value and fires change", () => {
    document.body.innerHTML =
      '<select id="s"><option value="a">Apple</option><option value="b">Banana</option></select>';
    const sel = document.getElementById("s") as HTMLSelectElement;
    inject();

    mousedown(sel);
    expect(overlay()!.style.display).toBe("block");
    expect(rows().length).toBe(2);

    const onChange = vi.fn();
    sel.addEventListener("change", onChange);
    mousedown(rows()[1]); // Banana
    expect(sel.value).toBe("b");
    expect(onChange).toHaveBeenCalledOnce();
    expect(overlay()!.style.display).toBe("none");
  });

  it("renders disabled options as non-selectable", () => {
    document.body.innerHTML =
      '<select id="s"><option value="a">Apple</option><option value="b" disabled>Banana</option></select>';
    const sel = document.getElementById("s") as HTMLSelectElement;
    inject();

    mousedown(sel);
    mousedown(rows()[1]); // disabled Banana
    expect(sel.value).toBe("a"); // unchanged
    expect(overlay()!.style.display).toBe("block"); // overlay stays open
  });

  it("re-injecting every step does not disrupt an already-open overlay", () => {
    document.body.innerHTML =
      '<select id="s"><option value="a">Apple</option><option value="b">Banana</option></select>';
    const sel = document.getElementById("s") as HTMLSelectElement;
    inject();
    mousedown(sel);
    expect(overlay()!.style.display).toBe("block");

    inject(); // simulate the next screenshot step re-injecting the shim
    expect(overlay()!.style.display).toBe("block"); // still open
    mousedown(rows()[1]); // and still selectable
    expect(sel.value).toBe("b");
  });

  it("does not open the overlay for a hidden select", () => {
    document.body.innerHTML =
      '<select id="s" style="display:none"><option value="a">A</option></select>';
    const sel = document.getElementById("s") as HTMLSelectElement;
    inject();
    expect(overlay()).not.toBeNull(); // container is created
    mousedown(sel);
    expect(overlay()!.style.display).toBe("none"); // but a hidden select never opens it
  });

  it("recovers if the page tears down the overlay between steps", () => {
    document.body.innerHTML =
      '<select id="s"><option value="a">Apple</option><option value="b">Banana</option></select>';
    const sel = document.getElementById("s") as HTMLSelectElement;
    inject();
    mousedown(sel);
    expect(overlay()!.style.display).toBe("block");

    overlay()!.remove(); // simulate an SPA re-render tearing the overlay down
    inject(); // next screenshot step re-injects the shim

    // the still-bound select must rebuild a working overlay, not point at a
    // detached node
    mousedown(sel);
    expect(overlay()).not.toBeNull();
    expect(overlay()!.style.display).toBe("block");
    mousedown(rows()[1]);
    expect(sel.value).toBe("b");
  });
});
