import { Page, ElementHandle } from "playwright";

interface AccessibilityInfo {
  role?: string;
  name?: string;
  description?: string;
  focused?: boolean;
  expanded?: boolean;
}

export async function getAccessibilityInfo(
  page: Page,
  element: ElementHandle<Element>,
): Promise<AccessibilityInfo> {
  const snapshot = await page.accessibility.snapshot({
    root: element,
  });
  return {
    role: snapshot?.role,
    name: snapshot?.name,
    description: snapshot?.description,
    focused: snapshot?.focused,
    expanded: snapshot?.expanded,
  };
}

export function isAccessibleInteractive(
  snapshot: AccessibilityInfo | null,
): boolean {
  const interactiveRoles = ["button", "link", "menuitem", "checkbox", "radio"];
  return Boolean(snapshot?.role && interactiveRoles.includes(snapshot.role));
}
