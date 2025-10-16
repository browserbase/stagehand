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

export function dispatchDomClick(this: Element, options?: ClickEventOptions): void {
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

export function scrollElementToPercent(this: Element, percent: number | string): boolean {
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
      const scrollHeight = root?.scrollHeight ?? document.body.scrollHeight ?? 0;
      const viewportHeight = element.ownerDocument?.defaultView?.innerHeight ?? window.innerHeight;
      const maxTop = Math.max(0, scrollHeight - viewportHeight);
      const top = maxTop * (pct / 100);
      element.ownerDocument?.defaultView?.scrollTo({
        top,
        left: element.ownerDocument?.defaultView?.scrollX ?? window.scrollX ?? 0,
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

export function fillElementValue(this: Element, value: string): void {
  try {
    if (("value" in this) && this instanceof HTMLElement) {
      (this as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value = value;
    } else if ((this as HTMLElement).isContentEditable) {
      (this as HTMLElement).textContent = value;
    }

    const inputEvent = new Event("input", { bubbles: true });
    const changeEvent = new Event("change", { bubbles: true });
    this.dispatchEvent(inputEvent);
    this.dispatchEvent(changeEvent);
  } catch {
    /* ignore */
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

export function selectElementOptions(this: Element, rawValues: string | string[]): string[] {
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

    const style = element.ownerDocument?.defaultView?.getComputedStyle(element) ?? window.getComputedStyle(element);
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
      return String((element as HTMLInputElement | HTMLTextAreaElement).value ?? "");
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
