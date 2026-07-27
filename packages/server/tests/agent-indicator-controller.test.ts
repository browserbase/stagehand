import { describe, expect, it, vi } from "vitest";
import {
  AGENT_INDICATOR_GET_MESSAGE,
  AGENT_INDICATOR_SET_MESSAGE,
} from "../agentIndicatorMessages.ts";
import {
  createAgentIndicatorController,
  type AgentIndicatorChrome,
} from "../agentIndicatorController.ts";

function createChromeApi() {
  let messageListener:
    | ((
        message: unknown,
        sender: unknown,
        sendResponse: (response: { active: boolean }) => void,
      ) => boolean | undefined)
    | undefined;
  const query = vi.fn(async () => [{ id: 12 }, {}, { id: 34 }]);
  const sendMessage = vi.fn(async () => {});
  const chromeApi: AgentIndicatorChrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
    },
    tabs: { query, sendMessage },
  };
  return {
    chromeApi,
    query,
    sendMessage,
    message: (value: unknown) => {
      let response: { active: boolean } | undefined;
      messageListener?.(value, {}, (value) => {
        response = value;
      });
      return response;
    },
  };
}

describe("agent indicator controller", () => {
  it("broadcasts state changes and answers document-start status requests", async () => {
    const { chromeApi, query, sendMessage, message } = createChromeApi();
    const controller = createAgentIndicatorController(chromeApi);

    expect(message({ type: AGENT_INDICATOR_GET_MESSAGE })).toStrictEqual({ active: false });
    await controller.setActive(true);

    expect(controller.active()).toBe(true);
    expect(query).toHaveBeenCalledWith({});
    expect(sendMessage.mock.calls).toStrictEqual([
      [12, { type: AGENT_INDICATOR_SET_MESSAGE, active: true }],
      [34, { type: AGENT_INDICATOR_SET_MESSAGE, active: true }],
    ]);
    expect(message({ type: AGENT_INDICATOR_GET_MESSAGE })).toStrictEqual({ active: true });
  });

  it("ignores duplicate states and tab delivery failures", async () => {
    const { chromeApi, query, sendMessage } = createChromeApi();
    sendMessage.mockRejectedValueOnce(new Error("restricted tab"));
    const controller = createAgentIndicatorController(chromeApi);

    await expect(controller.setActive(true)).resolves.toBeUndefined();
    await expect(controller.setActive(true)).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
