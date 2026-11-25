import type { Action } from "@browserbasehq/stagehand-protocol/types";
import type { Protocol } from "devtools-protocol";
import { resolveLocatorWithHops } from "../../../understudy/deepLocator.js";
import type { Snapshot, TargetResult } from "../pick.js";
import { buildView, type OutlineNode, type ViewKind } from "../tree.js";
import { capture, selectorFor, sleep, snapshot } from "./page.js";
import type { DecisionsActDeps, PipelineContext } from "./types.js";

const READY_POLL_MS = 150;

export async function pickWhenReady(
  ctx: PipelineContext,
  pick: (snap: Snapshot) => Promise<TargetResult>,
  pointer: boolean,
  view: ViewKind,
): Promise<{ snap: Snapshot; picked: TargetResult }> {
  const { deps } = ctx;
  if (ctx.config.targetReadiness && deps.settled && !ctx.ready) {
    let settled = false;
    const mark = (): void => {
      settled = true;
    };
    deps.settled.then(mark, mark);
    const startedAt = performance.now();
    let attempt = 0;
    let lastSignature = "";
    let last: { snap: Snapshot; picked: TargetResult } | undefined;
    while (!settled) {
      attempt++;
      const early = ctx.earlySnapshot;
      ctx.earlySnapshot = undefined;
      let snap: Snapshot;
      try {
        snap = await (early ?? capture(deps, ctx.trace));
      } catch (error) {
        ctx.trace.push({
          node: "not_ready",
          ms: Math.round(performance.now() - startedAt),
          attempt,
          why: "snapshot_failed",
          detail: error instanceof Error ? error.name : "error",
          settled,
        });
        await Promise.race([deps.settled.catch(() => {}), sleep(READY_POLL_MS)]);
        continue;
      }
      const signature = [...buildView(snap.nodes, view), ...buildView(snap.nodes, "broad")]
        .map((node) => `${node.id}:${node.name}`)
        .join("|");
      let picked: TargetResult;
      let asked = false;
      if (signature !== lastSignature || !last) {
        picked = await pick(snap);
        asked = true;
        lastSignature = signature;
      } else {
        picked = last.picked;
      }
      last = { snap, picked };
      const target = picked.target
        ? snap.nodes.find((node) => node.id === picked.target!.id)
        : undefined;
      const guard = target
        ? await staysPut(deps, snap, target, pointer)
        : { verdict: picked.target ? "target_gone" : "not_found" };
      const stable = guard.verdict === "ok";
      ctx.trace.push({
        node: stable ? "ready" : "not_ready",
        ms: Math.round(performance.now() - startedAt),
        attempt,
        asked,
        ...(stable ? {} : { why: guard.verdict }),
        ...(guard.cover ? { cover: (ctx.redact ?? ((text: string) => text))(guard.cover) } : {}),
        settled,
      });
      if (stable) {
        ctx.ready = true;
        return { snap, picked: { ...picked, target } };
      }
      await Promise.race([deps.settled.catch(() => {}), sleep(READY_POLL_MS)]);
    }
  }
  const snap = await snapshot(deps);
  return { snap, picked: await pick(snap) };
}

export async function staysPut(
  deps: DecisionsActDeps,
  snap: Snapshot,
  target: OutlineNode,
  pointer: boolean,
): Promise<GuardResult> {
  const selector = selectorFor(snap, target);
  if (!selector) return { verdict: "no_selector" };
  try {
    const locator = await resolveLocatorWithHops(deps.page, deps.page.mainFrame(), selector);
    const expected = Number(target.id.slice(target.id.lastIndexOf("-") + 1));
    if ((await locator.backendNodeId()) !== expected) return { verdict: "other_node" };
    const session = locator.getFrame().session;
    const { objectId } = await locator.resolveNode();
    try {
      const response = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: targetGuard.toString(),
          arguments: [{ value: pointer }],
          awaitPromise: true,
          returnByValue: true,
        },
      );
      const result = response.result.value as GuardResult | undefined;
      return result ?? { verdict: "no_verdict" };
    } finally {
      await session.send<never>("Runtime.releaseObject", { objectId }).catch(() => {});
    }
  } catch {
    return { verdict: "probe_failed" };
  }
}

const PRE_ACT_GUARD_MS = 1500;

const PRE_ACT_POLL_MS = 150;

export function isPointer(action: Action): boolean {
  return action.method === "click" || action.method === "hover" || action.method === "doubleClick";
}

export async function waitForClickable(
  ctx: PipelineContext,
  snap: Snapshot,
  target: OutlineNode,
): Promise<void> {
  const startedAt = performance.now();
  let result: { verdict: string; cover?: string } = { verdict: "" };
  let polls = 0;
  while (performance.now() - startedAt < PRE_ACT_GUARD_MS) {
    result = await staysPut(ctx.deps, snap, target, true);
    if (result.verdict !== "covered" && result.verdict !== "moving") break;
    polls++;
    await sleep(PRE_ACT_POLL_MS);
  }
  if (polls > 0) {
    ctx.trace.push({
      node: "pre_act_guard",
      ms: Math.round(performance.now() - startedAt),
      polls,
      verdict: result.verdict,
      ...(result.cover ? { cover: (ctx.redact ?? ((text: string) => text))(result.cover) } : {}),
    });
  }
}

type GuardResult = {
  verdict: string;
  cover?: string;
};

function targetGuard(this: Element, pointer: boolean): Promise<GuardResult> {
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
      if (pointer && inView) {
        const root = element.getRootNode() as Document | ShadowRoot;
        const hit = root.elementFromPoint(x, y) ?? document.elementFromPoint(x, y);
        const encloses = (outer: Element, inner: Element): boolean => {
          for (let node: Node | null = inner; node;) {
            if (node === outer || (node instanceof Element && outer.contains(node))) return true;
            const rootNode = node.getRootNode();
            node = rootNode instanceof ShadowRoot ? rootNode.host : null;
          }
          return false;
        };
        if (hit && hit !== element && !element.contains(hit) && !encloses(hit, element)) {
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
