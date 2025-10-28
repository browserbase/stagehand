import { Page } from "../understudy/page";

export function cloneForCache<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function safeGetPageUrl(page: Page): Promise<string> {
  try {
    return page.url();
  } catch {
    return "";
  }
}
