import {
  AGENT_INDICATOR_GET_MESSAGE,
  AGENT_INDICATOR_SET_MESSAGE,
} from "./agentIndicatorMessages.js";

export type AgentIndicatorMessage =
  | { type: typeof AGENT_INDICATOR_SET_MESSAGE; active: boolean }
  | { type: typeof AGENT_INDICATOR_GET_MESSAGE };

type ChromeEvent<Listener extends (...args: never[]) => unknown> = {
  addListener(listener: Listener): void;
};

export type AgentIndicatorChrome = {
  runtime: {
    onMessage: ChromeEvent<
      (
        message: unknown,
        sender: unknown,
        sendResponse: (response: { active: boolean }) => void,
      ) => boolean | undefined
    >;
  };
  tabs: {
    query(queryInfo: Record<string, never>): Promise<Array<{ id?: number }>>;
    sendMessage(tabId: number, message: AgentIndicatorMessage): Promise<unknown>;
  };
};

export type AgentIndicatorController = {
  active(): boolean;
  setActive(active: boolean): Promise<void>;
};

/** Synchronizes the session-wide indicator state with every extension-enabled tab. */
export function createAgentIndicatorController(
  chromeApi: AgentIndicatorChrome,
): AgentIndicatorController {
  let isActive = false;

  chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (isAgentIndicatorMessage(message) && message.type === AGENT_INDICATOR_GET_MESSAGE) {
      sendResponse({ active: isActive });
      return false;
    }
    return undefined;
  });

  return {
    active: () => isActive,
    async setActive(active) {
      if (isActive === active) return;
      isActive = active;
      const tabs = await chromeApi.tabs.query({});
      await Promise.allSettled(
        tabs.flatMap((tab) =>
          tab.id === undefined
            ? []
            : [
                chromeApi.tabs.sendMessage(tab.id, {
                  type: AGENT_INDICATOR_SET_MESSAGE,
                  active,
                }),
              ],
        ),
      );
    },
  };
}

function isAgentIndicatorMessage(value: unknown): value is AgentIndicatorMessage {
  if (!value || typeof value !== "object") return false;
  const type = Reflect.get(value, "type");
  if (type === AGENT_INDICATOR_GET_MESSAGE) return true;
  return type === AGENT_INDICATOR_SET_MESSAGE && typeof Reflect.get(value, "active") === "boolean";
}
