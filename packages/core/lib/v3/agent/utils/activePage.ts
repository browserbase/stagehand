import { Page } from "../../understudy/page";
import { V3 } from "../../v3";

export async function resolveActivePage(v3: V3, page?: Page): Promise<Page> {
  return page ?? (await v3.context.awaitActivePage());
}
