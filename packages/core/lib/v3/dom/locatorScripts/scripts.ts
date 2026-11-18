/*
 * DOM-side helpers used by Locator Runtime.callFunctionOn invocations.
 *
 * NOTE: These functions run inside the page context. Keep them dependency-free
 * and resilient to exceptions (match the best-effort semantics of the old
 * inline string snippets).
 */

export interface ClickEventOptions {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
  detail?: number;
}

export function ensureFileInputElement(this: Element): boolean {
  try {
    const tag = (this as HTMLElement).tagName?.toLowerCase() ?? "";
    if (tag !== "input") return false;
    const type = String((this as HTMLInputElement).type ?? "").toLowerCase();
    return type === "file";
  } catch {
    return false;
  }
}

export interface SerializedFilePayload {
  name: string;
  mimeType: string;
  base64: string;
  lastModified?: number;
}

/** Attach File objects created from serialized payloads to an <input type="file">. */
export function assignFilePayloadsToInputElement(
  this: Element,
  payloads: SerializedFilePayload[],
): boolean {
  try {
    const input = this as HTMLInputElement;
    if (!input || input.tagName?.toLowerCase() !== "input") return false;
    if ((input.type ?? "").toLowerCase() !== "file") return false;

    const transfer: DataTransfer | null = (() => {
      try {
        return new DataTransfer();
      } catch {
        return null;
      }
    })();
    if (!transfer) return false;

    const entries = Array.isArray(payloads) ? payloads : [];
    for (const payload of entries) {
      if (!payload) continue;
      const name = payload.name || "upload.bin";
      const mimeType = payload.mimeType || "application/octet-stream";
      const lastModified =
        typeof payload.lastModified === "number"
          ? payload.lastModified
          : Date.now();

      const binary = window.atob(payload.base64 ?? "");
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mimeType });
      const file = new File([blob], name, { type: mimeType, lastModified });
      transfer.items.add(file);
    }

    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

export function dispatchDomClick(
  this: Element,
  options?: ClickEventOptions,
): void {
  const opts = options ?? {};
  try {
    const event = new MouseEvent("click", {
      bubbles: !!opts.bubbles,
      cancelable: !!opts.cancelable,
      composed: !!opts.composed,
      detail: typeof opts.detail === "number" ? opts.detail : 1,
      view: this?.ownerDocument?.defaultView ?? window,
    });
    this.dispatchEvent(event);
  } catch {
    try {
      // Fallback to native click if MouseEvent construction fails.
      (this as HTMLElement).click();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Result of {@link findClickablePoint}.
 *
 * - `ok`: clicking at (`fx`, `fy`) reaches the element. Both are fractions
 *   (0–1) of the element's bounding rect (`getBoundingClientRect()`, i.e. the
 *   axis-aligned border box) at the scroll position the function left the
 *   page in.
 * - `covered`: every point tried was covered by another element. The page is
 *   left with the element scrolled to the center of the viewport, and
 *   `coveredBy` describes what is on top at the element's center there
 *   (e.g. `div#footer`), or null if nothing is (e.g. the point is off-screen).
 */
export type ClickablePointResult =
  | { status: "ok"; fx: number; fy: number }
  | { status: "covered"; coveredBy: string | null };

/**
 * Find a point on the element that a real pointer click would actually reach,
 * scrolling the element if something (a fixed header/footer, a banner)
 * covers it.
 *
 * Order of attempts:
 *  1) the element's center, at the current scroll position, then with the
 *     element scrolled to the center, end and start of the viewport;
 *  2) a few off-center points at each of those scroll positions. Center is
 *     preferred because for sliders, canvases and maps the position matters.
 *
 * A point "reaches" the element when the topmost element there (per
 * `elementFromPoint` on the element's own document or shadow root) is the
 * element, something inside it, or one of its `<label>`s (custom checkboxes
 * often hide the native input under its label).
 *
 * Scrolls are instant (not smooth) so measurements reflect the final layout.
 * Everything runs in this one call, so the caller pays one CDP round trip.
 * Returns null if the element can't be measured (detached, zero-size, or an
 * unexpected error).
 */
export function findClickablePoint(this: Element): ClickablePointResult | null {
  try {
    const el = this as Element;
    if (!el.isConnected) return null;

    const root = el.getRootNode() as Document | ShadowRoot;
    if (typeof root.elementFromPoint !== "function") return null;

    const labels: Element[] = Array.from((el as HTMLInputElement).labels ?? []);

    // Whether a hit at some point counts as reaching `el`.
    const reaches = (hit: Element | null): boolean => {
      if (!hit) return false;
      for (let n: Node | null = hit; n; ) {
        if (n === el) return true;
        // Step out of shadow roots via their host.
        n = n.parentNode ?? (n as ShadowRoot).host ?? null;
      }
      return labels.some((label) => label === hit || label.contains(hit));
    };

    const pointIn = (rect: DOMRect, fx: number, fy: number) =>
      root.elementFromPoint(
        rect.left + rect.width * fx,
        rect.top + rect.height * fy,
      );

    type Block = "center" | "end" | "start";
    const scrollTo = (block: Block) =>
      el.scrollIntoView({ block, inline: block, behavior: "instant" });

    const measure = (): DOMRect | null => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? rect : null;
    };

    // 1) Center, at the current scroll position and then each alternative.
    const center = [0.5, 0.5] as const;
    const scrolls: Array<Block | null> = [null, "center", "end", "start"];
    for (const block of scrolls) {
      if (block) scrollTo(block);
      const rect = measure();
      if (!rect) return null;
      if (reaches(pointIn(rect, center[0], center[1]))) {
        return { status: "ok", fx: center[0], fy: center[1] };
      }
    }

    // 2) Off-center points. The original scroll position is gone by now, so
    //    retry the alternatives only.
    const offCenter: Array<readonly [number, number]> = [
      [0.5, 0.25],
      [0.5, 0.75],
      [0.25, 0.5],
      [0.75, 0.5],
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
    ];
    for (const block of ["center", "end", "start"] as const) {
      scrollTo(block);
      const rect = measure();
      if (!rect) return null;
      for (const [fx, fy] of offCenter) {
        if (reaches(pointIn(rect, fx, fy))) return { status: "ok", fx, fy };
      }
    }

    // Nothing reachable. Leave the element centered (the likeliest spot for a
    // fallback click to work) and report what is in the way.
    scrollTo("center");
    const rect = measure();
    const top = rect ? pointIn(rect, center[0], center[1]) : null;
    let coveredBy: string | null = null;
    if (top) {
      const tag = top.tagName.toLowerCase();
      const cls =
        typeof top.className === "string"
          ? top.className.trim().split(/\s+/)[0]
          : "";
      coveredBy = top.id ? `${tag}#${top.id}` : cls ? `${tag}.${cls}` : tag;
    }
    return { status: "covered", coveredBy };
  } catch {
    return null;
  }
}

export function scrollElementToPercent(
  this: Element,
  percent: number | string,
): boolean {
  const normalize = (value: unknown): number => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const str = String(value ?? "").trim();
    if (!str) return 0;
    const numeric = parseFloat(str.replace("%", ""));
    if (Number.isNaN(numeric) || !Number.isFinite(numeric)) return 0;
    return numeric;
  };

  try {
    const pct = Math.max(0, Math.min(normalize(percent), 100));
    const element = this as HTMLElement;
    const tag = element.tagName?.toLowerCase() ?? "";

    const scrollWindow = tag === "html" || tag === "body";
    if (scrollWindow) {
      const root =
        element.ownerDocument?.scrollingElement ||
        element.ownerDocument?.documentElement ||
        element.ownerDocument?.body ||
        document.scrollingElement ||
        document.documentElement ||
        document.body;
      const scrollHeight =
        root?.scrollHeight ?? document.body.scrollHeight ?? 0;
      const viewportHeight =
        element.ownerDocument?.defaultView?.innerHeight ?? window.innerHeight;
      const maxTop = Math.max(0, scrollHeight - viewportHeight);
      const top = maxTop * (pct / 100);
      element.ownerDocument?.defaultView?.scrollTo({
        top,
        left:
          element.ownerDocument?.defaultView?.scrollX ?? window.scrollX ?? 0,
        behavior: "smooth",
      });
      return true;
    }

    const scrollHeight = element.scrollHeight ?? 0;
    const clientHeight = element.clientHeight ?? 0;
    const maxTop = Math.max(0, scrollHeight - clientHeight);
    const top = maxTop * (pct / 100);
    element.scrollTo({
      top,
      left: element.scrollLeft ?? 0,
      behavior: "smooth",
    });
    return true;
  } catch {
    return false;
  }
}

const inputTypesToSetValue = new Set([
  "color",
  "date",
  "datetime-local",
  "month",
  "range",
  "time",
  "week",
]);

const inputTypesToTypeInto = new Set([
  "",
  "email",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);

export type FillElementResult =
  | { status: "done" }
  | { status: "needsinput"; value: string; reason?: string }
  | { status: "error"; reason: string };

export function prepareElementForTyping(this: Element): boolean {
  try {
    const element = this as HTMLElement;
    if (!element.isConnected) return false;

    const doc = element.ownerDocument || document;
    const win = doc.defaultView || window;

    try {
      if (typeof element.focus === "function") {
        element.focus();
      }
    } catch {
      /* ignore */
    }

    if (
      element instanceof win.HTMLInputElement ||
      element instanceof win.HTMLTextAreaElement
    ) {
      try {
        if (typeof element.select === "function") {
          element.select();
          return true;
        }
      } catch {
        /* ignore */
      }

      try {
        const length = (element.value ?? "").length;
        if (typeof element.setSelectionRange === "function") {
          element.setSelectionRange(0, length);
          return true;
        }
      } catch {
        /* ignore */
      }

      return true;
    }

    if (element.isContentEditable) {
      const selection = doc.getSelection?.();
      const range = doc.createRange?.();
      if (selection && range) {
        try {
          range.selectNodeContents(element);
          selection.removeAllRanges();
          selection.addRange(range);
        } catch {
          /* ignore */
        }
      }
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export function fillElementValue(
  this: Element,
  rawValue: string,
): FillElementResult {
  const element = this as HTMLElement;
  if (!element.isConnected) {
    return { status: "error", reason: "notconnected" };
  }

  const doc = element.ownerDocument || document;
  const win = doc.defaultView || window;
  let fallbackValue = rawValue ?? "";

  try {
    const dispatchInputAndChange = (eventValue: string): void => {
      let inputEvent: Event;
      if (typeof win.InputEvent === "function") {
        try {
          inputEvent = new win.InputEvent("input", {
            bubbles: true,
            composed: true,
            data: eventValue,
            inputType: "insertText",
          });
        } catch {
          inputEvent = new win.Event("input", {
            bubbles: true,
            composed: true,
          });
        }
      } else {
        inputEvent = new win.Event("input", { bubbles: true, composed: true });
      }

      element.dispatchEvent(inputEvent);

      const changeEvent = new win.Event("change", { bubbles: true });
      element.dispatchEvent(changeEvent);
    };

    if (element instanceof win.HTMLInputElement) {
      const type = (element.type || "").toLowerCase();

      if (!inputTypesToTypeInto.has(type) && !inputTypesToSetValue.has(type)) {
        return { status: "error", reason: `unsupported-input-type:${type}` };
      }

      let valueForTyping = rawValue;

      if (type === "number") {
        const trimmed = rawValue.trim();
        if (trimmed !== "" && Number.isNaN(Number(trimmed))) {
          return { status: "error", reason: "invalid-number-value" };
        }
        valueForTyping = trimmed;
      }

      fallbackValue = valueForTyping;

      if (inputTypesToSetValue.has(type)) {
        const trimmed = rawValue.trim();
        fallbackValue = trimmed;
        prepareElementForTyping.call(element);

        const prototype = win.HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        const nativeSetter = descriptor?.set;

        if (typeof nativeSetter === "function") {
          nativeSetter.call(element, trimmed);
        } else {
          element.value = trimmed;
        }

        const tracker = (
          element as unknown as {
            _valueTracker?: { setValue?: (next: string) => void };
          }
        )._valueTracker;
        tracker?.setValue?.(trimmed);

        if (element.value !== trimmed) {
          return { status: "error", reason: "malformed-value" };
        }

        dispatchInputAndChange(trimmed);
        return { status: "done" };
      }

      prepareElementForTyping.call(element);
      return { status: "needsinput", value: valueForTyping };
    }

    if (element instanceof win.HTMLTextAreaElement) {
      prepareElementForTyping.call(element);
      fallbackValue = rawValue;
      return { status: "needsinput", value: rawValue };
    }

    if (element instanceof win.HTMLSelectElement) {
      // Select elements use setInputFiles/selectOption instead.
      return { status: "error", reason: "unsupported-element" };
    }

    if (element.isContentEditable) {
      prepareElementForTyping.call(element);
      fallbackValue = rawValue;
      return { status: "needsinput", value: rawValue };
    }

    return { status: "error", reason: "unsupported-element" };
  } catch (error) {
    let reason = "exception";
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim().length > 0) {
        reason = `exception:${message}`;
      }
    }
    return { status: "needsinput", value: fallbackValue, reason };
  }
}

export function focusElement(this: Element): void {
  try {
    if (typeof (this as HTMLElement).focus === "function") {
      (this as HTMLElement).focus();
    }
  } catch {
    /* ignore */
  }
}

export function selectElementOptions(
  this: Element,
  rawValues: string | string[],
): string[] {
  try {
    if (!(this instanceof HTMLSelectElement)) return [];

    const desired = Array.isArray(rawValues) ? rawValues : [rawValues];
    const wanted = new Set(desired.map((v) => String(v ?? "").trim()));

    const matches = (option: HTMLOptionElement): boolean => {
      const label = (option.label || option.textContent || "").trim();
      const value = String(option.value ?? "").trim();
      return wanted.has(label) || wanted.has(value);
    };

    if (this.multiple) {
      for (const option of Array.from(this.options)) {
        option.selected = matches(option);
      }
    } else {
      let chosen = false;
      for (const option of Array.from(this.options)) {
        if (!chosen && matches(option)) {
          option.selected = true;
          this.value = option.value;
          chosen = true;
        } else {
          option.selected = false;
        }
      }
    }

    const inputEvent = new Event("input", { bubbles: true });
    const changeEvent = new Event("change", { bubbles: true });
    this.dispatchEvent(inputEvent);
    this.dispatchEvent(changeEvent);

    return Array.from(this.selectedOptions).map((opt) => opt.value);
  } catch {
    return [];
  }
}

export function isElementVisible(this: Element): boolean {
  try {
    const element = this as HTMLElement;
    if (!element.isConnected) return false;

    const style =
      element.ownerDocument?.defaultView?.getComputedStyle(element) ??
      window.getComputedStyle(element);
    if (!style) return false;
    if (style.display === "none" || style.visibility === "hidden") return false;
    const opacity = parseFloat(style.opacity ?? "1");
    if (!Number.isFinite(opacity) || opacity === 0) return false;

    const rect = element.getBoundingClientRect();
    if (!rect) return false;
    if (Math.max(rect.width, rect.height) === 0) return false;

    if (element.getClientRects().length === 0) return false;
    return true;
  } catch {
    return false;
  }
}

export function isElementChecked(this: Element): boolean {
  try {
    const element = this as HTMLElement;
    const tag = (element.tagName || "").toLowerCase();
    if (tag === "input") {
      const type = (element as HTMLInputElement).type?.toLowerCase() ?? "";
      if (type === "checkbox" || type === "radio") {
        return !!(element as HTMLInputElement).checked;
      }
    }
    const aria = element.getAttribute?.("aria-checked");
    if (aria != null) return aria === "true";
    return false;
  } catch {
    return false;
  }
}

export function readElementInputValue(this: Element): string {
  try {
    const element = this as HTMLElement;
    const tag = (element.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") {
      return String(
        (element as HTMLInputElement | HTMLTextAreaElement).value ?? "",
      );
    }
    if (tag === "select") {
      return String((element as HTMLSelectElement).value ?? "");
    }
    if (element.isContentEditable) {
      return String(element.textContent ?? "");
    }
    return "";
  } catch {
    return "";
  }
}

export function readElementTextContent(this: Element): string {
  try {
    return String(this.textContent ?? "");
  } catch {
    return "";
  }
}

export function readElementInnerHTML(this: Element): string {
  try {
    return String((this as HTMLElement).innerHTML ?? "");
  } catch {
    return "";
  }
}

export function readElementInnerText(this: Element): string {
  try {
    const element = this as HTMLElement;
    const inner = (element as HTMLElement & { innerText?: unknown }).innerText;
    if (typeof inner === "string" && inner.length > 0) {
      return inner;
    }
    const fallback = element.textContent;
    return typeof fallback === "string" ? fallback : "";
  } catch {
    return "";
  }
}
