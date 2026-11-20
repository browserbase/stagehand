export type ElementFacts = {
  visible: boolean;
  enabled: boolean;
  editable: boolean;
  readonly: boolean;
  tag: string;
  type: string;
  name: string;
  text: string;
  href?: string;
  title?: string;
  value?: string;
  checked?: boolean;
  context: string;
  editableRoot?: boolean;
  transparentText?: boolean;
};

// Serialized into the page. Keep all DOM reads inside this function.
export function readFacts(
  paths: Record<string, string>,
  resolvePath?: (path: string) => Element | null,
): Record<string, ElementFacts> {
  const result: Record<string, ElementFacts> = {};
  // DOM maps visit parents before children. An indexed child of a unique parent
  // is also unique, so its descendants can start their XPath lookups there.
  const parents = new Map<string, Node>([["", document]]);
  const childStep = /^(?:[a-z][a-z0-9-]*|text\(\)|comment\(\))\[[1-9]\d*\]$/u;
  let validity: XPathResult | undefined;
  for (const [id, path] of Object.entries(paths)) {
    try {
      const slash = path.lastIndexOf("/");
      const step = path.slice(slash + 1);
      const parent = parents.get(path.slice(0, slash));
      const relative =
        parent && slash >= 0 && childStep.test(step) && !validity?.invalidIteratorState;
      const found = resolvePath
        ? resolvePath(path)
        : document.evaluate(
            relative ? step : path,
            relative ? parent : document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null,
          ).singleNodeValue;
      if (relative && found instanceof Element) {
        // A page-defined property getter can mutate the DOM during this loop.
        validity ??= document.evaluate(
          ".",
          document,
          null,
          XPathResult.UNORDERED_NODE_ITERATOR_TYPE,
        );
        parents.set(path, found);
      }
      const element = found instanceof Element ? found : found?.parentElement;
      if (!element) continue;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const input = element as HTMLInputElement;
      const disabled =
        element.matches(":disabled") || Boolean(element.closest('[inert],[aria-disabled="true"]'));
      const context = element.closest('li,tr,[role="row"],fieldset,[role="dialog"]');
      const title = element.getAttribute("title");
      result[id] = {
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.visibility !== "collapse" &&
          style.display !== "none" &&
          !element.closest('[hidden],[aria-hidden="true"]'),
        enabled: !disabled,
        ...(found instanceof Text && style.pointerEvents === "none"
          ? { transparentText: true }
          : {}),
        editable:
          Boolean((element as HTMLElement).isContentEditable) ||
          element.matches(
            'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]):not([type="hidden"]):not([type="file"]),textarea',
          ),
        readonly: Boolean(input.readOnly),
        editableRoot:
          found instanceof HTMLElement &&
          found.isContentEditable &&
          !found.parentElement?.isContentEditable,
        tag: element.tagName.toLowerCase(),
        type: input.type ?? "",
        name: element.getAttribute("aria-label") ?? element.getAttribute("placeholder") ?? "",
        ...(title ? { title } : {}),
        text: (element.textContent ?? "").trim().slice(0, 160),
        ...(element instanceof HTMLAnchorElement ? { href: element.href } : {}),
        ...("value" in element ? { value: String(input.value) } : {}),
        ...(element.matches('input[type="checkbox"],input[type="radio"]')
          ? { checked: input.checked }
          : {}),
        context: (context?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      };
    } catch {
      // Cross-frame and shadow paths need the extension's deep locator.
    }
  }
  return result;
}
