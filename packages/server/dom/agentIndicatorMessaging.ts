export type AgentIndicatorPaintResponse = { painted: boolean };

export function handleAgentIndicatorSetMessage(
  message: unknown,
  setMessageType: string,
  setActive: (active: boolean) => boolean,
  respondAfterPaint: (sendResponse: (response: AgentIndicatorPaintResponse) => void) => void,
  sendResponse: (response: AgentIndicatorPaintResponse) => void,
): boolean | undefined {
  if (
    !message ||
    typeof message !== "object" ||
    Reflect.get(message, "type") !== setMessageType ||
    typeof Reflect.get(message, "active") !== "boolean"
  ) {
    return undefined;
  }

  if (!setActive(Reflect.get(message, "active") as boolean)) {
    sendResponse({ painted: false });
    return false;
  }

  respondAfterPaint(sendResponse);
  return true;
}
