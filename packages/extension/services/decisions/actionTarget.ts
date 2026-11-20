import type { Protocol } from "devtools-protocol";
import { resolveLocatorWithHops } from "../../understudy/deepLocator.js";
import type { Locator } from "../../understudy/locator.js";
import type { Page } from "../../understudy/page.js";
import type { Progress } from "../../understudy/progress.js";

type GuardResult = { verdict: string; cover?: string; position?: string };

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
      return await checkResolvedTarget(
        page,
        locator,
        objectId,
        progress,
        pointer ? "content" : "none",
        false,
      );
    } finally {
      await progress.cleanup(() => session.send("Runtime.releaseObject", { objectId }));
    }
  } catch {
    progress.throwIfStopped();
    return { verdict: "probe_failed" };
  }
}

export async function checkResolvedTarget(
  page: Page,
  locator: Locator,
  objectId: string,
  progress: Progress,
  point: "content" | "rect" | "none",
  requireInView: boolean,
): Promise<GuardResult> {
  const { frameId, session } = locator.getFrame();
  const probe = async (fn: string, args: unknown[]): Promise<GuardResult> => {
    const response = await progress.run("checking action target", () =>
      session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: fn,
        arguments: args.map((value) => ({ value })),
        awaitPromise: true,
        returnByValue: true,
      }),
    );
    return response.exceptionDetails
      ? { verdict: "probe_failed" }
      : (response.result.value ?? { verdict: "no_verdict" });
  };
  const settled = await probe(checkTargetInPage.toString(), [requireInView]);
  if (settled.verdict !== "ok") return settled;
  if (point === "none") return { verdict: "ok" };
  if (point === "rect") return probe(hitTargetInPage.toString(), [requireInView, settled.position]);

  const { cx, cy } = await locator.contentPoint(objectId, progress);
  const parent = page.registry.getParent(frameId);
  if (!parent || page.getSessionForFrame(parent) !== session)
    return probe(hitTargetInPage.toString(), [requireInView, settled.position, { x: cx, y: cy }]);

  // In-process child frames share the parent's CDP viewport. The iframe content
  // quad includes every embedding transform up to the session root.
  const owner = await progress.run("resolving pointer target frame", () =>
    session.send<Protocol.DOM.GetFrameOwnerResponse>("DOM.getFrameOwner", { frameId }),
  );
  const { model } = await progress.run("reading pointer target frame geometry", () =>
    session.send<Protocol.DOM.GetBoxModelResponse>("DOM.getBoxModel", {
      backendNodeId: owner.backendNodeId,
    }),
  );
  const { u, v } = pointInFrameQuad(cx, cy, model.content);
  if (!Number.isFinite(u) || !Number.isFinite(v)) return { verdict: "no_hit" };
  return probe(hitTargetInPage.toString(), [
    requireInView,
    settled.position,
    { x: u, y: v, normalized: true },
  ]);
}

// Invert the projection from the iframe's unit square into its content quad.
// First express both points in the affine basis of the top and left edges.
function pointInFrameQuad(x: number, y: number, quad: number[]): { u: number; v: number } {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = quad;
  const edgeXX = x1 - x0;
  const edgeXY = y1 - y0;
  const edgeYX = x3 - x0;
  const edgeYY = y3 - y0;
  const determinant = edgeXX * edgeYY - edgeXY * edgeYX;
  const pointX = ((x - x0) * edgeYY - (y - y0) * edgeYX) / determinant;
  const pointY = (edgeXX * (y - y0) - edgeXY * (x - x0)) / determinant;
  const cornerX = ((x2 - x0) * edgeYY - (y2 - y0) * edgeYX) / determinant;
  const cornerY = (edgeXX * (y2 - y0) - edgeXY * (x2 - x0)) / determinant;
  // For a parallelogram both weights are 1. Perspective changes the weights
  // such that the opposite corner (cornerX,cornerY) still maps to (1,1).
  const weightX = (cornerX + cornerY - 1) / cornerX;
  const weightY = (cornerX + cornerY - 1) / cornerY;
  const w = 1 + (weightX - 1) * pointX + (weightY - 1) * pointY;
  return { u: (weightX * pointX) / w, v: (weightY * pointY) / w };
}

export function checkTargetInPage(this: Element, requireInView: boolean): Promise<GuardResult> {
  // oxlint-disable-next-line typescript/no-this-alias -- runs in the page with the element as `this`
  const element = this;
  const place = (): string => {
    const rect = element.getBoundingClientRect();
    return [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value)).join(",");
  };
  let before = place();
  const started = performance.now();
  return new Promise<GuardResult>((resolve) => {
    let frame = 0;
    let timer = 0;
    const finish = (): void => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      if (!element.isConnected) return resolve({ verdict: "detached" });
      if (element.matches(":disabled") || element.closest('[aria-disabled="true"],[inert]'))
        return resolve({ verdict: "disabled" });
      const current = place();
      if (current !== before) {
        // Scrolling can start a finite transition. Sample the same node again
        // before dispatch, bounded even when it is animated continuously.
        if (requireInView && performance.now() - started < 500) {
          before = current;
          schedule();
          return;
        }
        return resolve({ verdict: "moving" });
      }
      resolve({ verdict: "ok", position: current });
    };
    const schedule = () => {
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(finish);
      });
      timer = window.setTimeout(finish, 50);
    };
    schedule();
  });
}

export function hitTargetInPage(
  this: Element,
  requireInView: boolean,
  position: string,
  point?: { x: number; y: number; normalized?: boolean },
): GuardResult {
  if (!this.isConnected) return { verdict: "detached" };
  if (this.matches(":disabled") || this.closest('[aria-disabled="true"],[inert]'))
    return { verdict: "disabled" };
  const rect = this.getBoundingClientRect();
  const current = [rect.x, rect.y, rect.width, rect.height]
    .map((value) => Math.round(value))
    .join(",");
  if (current !== position) return { verdict: "moving" };
  const x = point ? point.x * (point.normalized ? innerWidth : 1) : rect.x + rect.width / 2;
  const y = point ? point.y * (point.normalized ? innerHeight : 1) : rect.y + rect.height / 2;
  const inView =
    rect.width > 0 && rect.height > 0 && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
  if (!inView) return { verdict: requireInView ? "outside_viewport" : "ok" };
  const root = this.getRootNode() as Document | ShadowRoot;
  // Inside a shadow root, a cover that lives in the light DOM makes
  // elementFromPoint return null; the document's answer is then the
  // cover (or the host chain, which counts as "hits the target").
  const hit = root.elementFromPoint(x, y) ?? document.elementFromPoint(x, y);
  if (!hit) return { verdict: "no_hit" };
  const isShadowHost = (outer: Element): boolean => {
    for (let rootNode = this.getRootNode(); rootNode instanceof ShadowRoot;) {
      if (outer === rootNode.host) return true;
      rootNode = rootNode.host.getRootNode();
    }
    return false;
  };
  if (hit !== this && !this.contains(hit) && !isShadowHost(hit)) {
    const label =
      hit.getAttribute("aria-label") ??
      hit.getAttribute("id") ??
      (hit.textContent ?? "").trim().slice(0, 60);
    return {
      verdict: "covered",
      cover: `${hit.tagName.toLowerCase()}${label ? `: ${label}` : ""}`,
    };
  }
  return { verdict: "ok" };
}
