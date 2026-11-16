import type { Action } from "@browserbasehq/stagehand-protocol/types";
import type { Protocol } from "devtools-protocol";
import { resolveLocatorWithHops } from "../../understudy/deepLocator.js";
import type { Page } from "../../understudy/page.js";
import type { Progress } from "../../understudy/progress.js";
import { checkTargetInPage } from "./actionTarget.js";

export async function guardActionTarget(
  page: Page,
  action: Action,
  progress: Progress,
  expectedElementId?: string,
  expectedDestinationElementId?: string,
): Promise<string | undefined> {
  const method = action.method?.trim() ?? "";
  if (
    ![
      "click",
      "doubleClick",
      "hover",
      "fill",
      "type",
      "selectOptionFromDropdown",
      "scrollTo",
      "nextChunk",
      "prevChunk",
      "press",
      "dragAndDrop",
    ].includes(method)
  )
    return;
  const rejection = await checkTarget(action.selector, expectedElementId);
  if (rejection || method !== "dragAndDrop") return rejection;
  const destination = action.arguments?.[0];
  if (!destination) return "drag_destination_missing";
  const destinationRejection = await checkTarget(destination, expectedDestinationElementId);
  return destinationRejection ? `drag_destination_${destinationRejection}` : undefined;

  async function checkTarget(selector: string, expectedId?: string): Promise<string | undefined> {
    try {
      const locator = await resolveLocatorWithHops(page, page.mainFrame(), selector, progress);
      const session = locator.getFrame().session;
      const { objectId } = await locator.resolveNode(progress);
      try {
        // Describe the same remote object we probe; resolving the selector again can inspect a replacement.
        if (expectedId) {
          const { node } = await progress.run("checking action target identity", () =>
            session.send<Protocol.DOM.DescribeNodeResponse>("DOM.describeNode", { objectId }),
          );
          const actualId = `${page.getOrdinal(locator.getFrame().frameId)}-${node.backendNodeId}`;
          if (actualId !== expectedId) return "target_replaced";
        }
        const response = await progress.run("checking action target eligibility", () =>
          session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
            objectId,
            functionDeclaration: actionEligibility.toString(),
            arguments: [{ value: method }],
            returnByValue: true,
          }),
        );
        if (response.exceptionDetails) return "target_check_failed";
        const verdict = response.result.value;
        if (verdict !== "ok") return typeof verdict === "string" ? verdict : "target_check_failed";
        if (["click", "doubleClick", "hover", "dragAndDrop"].includes(method)) {
          const hit = await progress.run("checking action pointer target", () =>
            session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
              objectId,
              functionDeclaration: checkTargetInPage.toString(),
              arguments: [{ value: true }],
              awaitPromise: true,
              returnByValue: true,
            }),
          );
          if (hit.exceptionDetails) return "target_check_failed";
          const hitVerdict = hit.result.value?.verdict;
          if (hitVerdict !== "ok")
            return typeof hitVerdict === "string" ? `target_${hitVerdict}` : "target_check_failed";
        }
        return undefined;
      } finally {
        await progress.cleanup(() => session.send("Runtime.releaseObject", { objectId }));
      }
    } catch {
      progress.throwIfStopped();
      return "target_unresolved";
    }
  }
}

function actionEligibility(this: Element, method: string): string {
  if (!this.isConnected) return "target_detached";
  if (["scrollTo", "nextChunk", "prevChunk", "press"].includes(method)) return "ok";
  if (this.matches(":disabled") || this.closest('[inert],[aria-disabled="true"]'))
    return "target_disabled";
  const rect = this.getBoundingClientRect();
  const style = getComputedStyle(this);
  if (
    !rect.width ||
    !rect.height ||
    style.visibility === "hidden" ||
    style.visibility === "collapse" ||
    this.closest('[hidden],[aria-hidden="true"]')
  )
    return "target_hidden";
  if (method === "fill" || method === "type") {
    if ((this as HTMLInputElement).readOnly) return "target_readonly";
    if (
      !(
        this instanceof HTMLInputElement ||
        this instanceof HTMLTextAreaElement ||
        (this as HTMLElement).isContentEditable
      )
    )
      return "target_not_editable";
    if (
      this instanceof HTMLInputElement &&
      ["checkbox", "radio", "file", "hidden", "button", "submit", "reset", "image"].includes(
        this.type,
      )
    )
      return "target_not_editable";
  }
  if (method === "selectOptionFromDropdown" && !(this instanceof HTMLSelectElement))
    return "target_not_native_select";
  return "ok";
}
