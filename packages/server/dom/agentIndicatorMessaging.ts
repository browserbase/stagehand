export type AgentIndicatorPaintResponse = { painted: boolean };

export type AgentIndicatorBootstrapGuard = {
  markSetReceived(): void;
  apply(active: boolean, setActive: (active: boolean) => boolean): boolean;
};

export function createAgentIndicatorBootstrapGuard(): AgentIndicatorBootstrapGuard {
  let setReceived = false;
  return {
    markSetReceived() {
      setReceived = true;
    },
    apply(active, setActive) {
      if (setReceived) return false;
      setActive(active);
      return true;
    },
  };
}

export function isAgentIndicatorSetMessage(
  message: unknown,
  setMessageType: string,
): message is { type: string; active: boolean } {
  return (
    !!message &&
    typeof message === "object" &&
    Reflect.get(message, "type") === setMessageType &&
    typeof Reflect.get(message, "active") === "boolean"
  );
}

export function handleAgentIndicatorSetMessage(
  message: unknown,
  setMessageType: string,
  setActive: (active: boolean) => boolean,
  respondAfterPaint: (sendResponse: (response: AgentIndicatorPaintResponse) => void) => void,
  sendResponse: (response: AgentIndicatorPaintResponse) => void,
): boolean | undefined {
  if (!isAgentIndicatorSetMessage(message, setMessageType)) {
    return undefined;
  }

  if (!setActive(Reflect.get(message, "active") as boolean)) {
    sendResponse({ painted: false });
    return false;
  }

  respondAfterPaint(sendResponse);
  return true;
}
