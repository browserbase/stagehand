import type { Protocol } from "devtools-protocol";
import { resolveLocatorWithHops } from "../../understudy/deepLocator.js";
import type { Page } from "../../understudy/page.js";
import type { Progress } from "../../understudy/progress.js";

type GuardResult = { verdict: string; cover?: string };

export async function checkSelectedTarget(
  page: Page,
  selector: string,
  expectedId: string,
  pointer: boolean,
  progress: Progress,
): Promise<GuardResult> {
  try {
    const locator = await resolveLocatorWithHops(page, page.mainFrame(), selector, progress);
    const session = locator.getFrame().session;
    const { objectId } = await locator.resolveNode(progress);
    try {
      const { node } = await progress.run("checking selected action identity", () =>
        session.send<Protocol.DOM.DescribeNodeResponse>("DOM.describeNode", { objectId }),
      );
      const actualId = `${page.getOrdinal(locator.getFrame().frameId)}-${node.backendNodeId}`;
      if (actualId !== expectedId) return { verdict: "other_node" };
      const response = await progress.run("checking selected action target", () =>
        session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: checkTargetInPage.toString(),
          arguments: [{ value: pointer }],
          awaitPromise: true,
          returnByValue: true,
        }),
      );
      return response.exceptionDetails
        ? { verdict: "probe_failed" }
        : (response.result.value ?? { verdict: "no_verdict" });
    } finally {
      await progress.cleanup(() => session.send("Runtime.releaseObject", { objectId }));
    }
  } catch {
    progress.throwIfStopped();
    return { verdict: "probe_failed" };
  }
}

export function checkTargetInPage(this: Element, pointer: boolean): Promise<GuardResult> {
  // oxlint-disable-next-line typescript/no-this-alias -- runs in the page with the element as `this`
  const element = this;
  const place = (): string => {
    const rect = element.getBoundingClientRect();
    return [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value)).join(",");
  };
  const before = place();
  return new Promise<GuardResult>((resolve) => {
    let frames = 0;
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      const out = (verdict: string, cover?: string): void =>
        resolve({ verdict, ...(cover ? { cover } : {}) });
      if (!element.isConnected) return out("detached");
      if (element.matches(":disabled") || element.closest('[aria-disabled="true"],[inert]'))
        return out("disabled");
      if (place() !== before) return out("moving");
      const rect = element.getBoundingClientRect();
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      const inView =
        rect.width > 0 && rect.height > 0 && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
      // Off-screen targets get scrolled into view by the action; nothing to hit-test yet.
      if (pointer && inView) {
        const root = element.getRootNode() as Document | ShadowRoot;
        // Inside a shadow root, a cover that lives in the light DOM makes
        // elementFromPoint return null; the document's answer is then the
        // cover (or the host chain, which counts as "hits the target").
        const hit = root.elementFromPoint(x, y) ?? document.elementFromPoint(x, y);
        if (!hit) return out("no_hit");
        const isShadowHost = (outer: Element): boolean => {
          for (let rootNode = element.getRootNode(); rootNode instanceof ShadowRoot;) {
            if (outer === rootNode.host) return true;
            rootNode = rootNode.host.getRootNode();
          }
          return false;
        };
        if (hit !== element && !element.contains(hit) && !isShadowHost(hit)) {
          const label =
            hit.getAttribute("aria-label") ??
            hit.getAttribute("id") ??
            (hit.textContent ?? "").trim().slice(0, 60);
          return out("covered", `${hit.tagName.toLowerCase()}${label ? `: ${label}` : ""}`);
        }
      }
      out("ok");
    };
    const tick = (): void => {
      if (++frames >= 2) finish();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(finish, 50);
  });
}
