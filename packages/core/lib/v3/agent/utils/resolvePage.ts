import { Page } from "../../understudy/page.js";
import { V3 } from "../../v3.js";

/**
 * Prefers the page parameter if provided, otherwise gets the active page via
 * `awaitActivePage()`.
 */
export async function resolvePage(v3: V3, page?: Page): Promise<Page> {
  return page ?? (await v3.context.awaitActivePage());
}
