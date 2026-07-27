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

  it("serializes overlapping transitions so the final broadcast matches the final state", async () => {
    const { chromeApi, query, sendMessage } = createChromeApi();
    let resolveFirstQuery: ((tabs: Array<{ id?: number }>) => void) | undefined;
    query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstQuery = resolve;
        }),
    );
    const controller = createAgentIndicatorController(chromeApi);

    const activate = controller.setActive(true);
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    const deactivate = controller.setActive(false);
    resolveFirstQuery?.([{ id: 12 }]);
    await Promise.all([activate, deactivate]);

    expect(controller.active()).toBe(false);
    expect(sendMessage.mock.calls).toStrictEqual([
      [12, { type: AGENT_INDICATOR_SET_MESSAGE, active: true }],
      [12, { type: AGENT_INDICATOR_SET_MESSAGE, active: false }],
      [34, { type: AGENT_INDICATOR_SET_MESSAGE, active: false }],
    ]);
  });

  it("retries the same desired state after a tab query failure", async () => {
    const { chromeApi, query, sendMessage } = createChromeApi();
    query.mockRejectedValueOnce(new Error("temporary tabs.query failure"));
    const controller = createAgentIndicatorController(chromeApi);

    await expect(controller.setActive(true)).rejects.toThrow("temporary tabs.query failure");
    expect(controller.active()).toBe(true);
    await expect(controller.setActive(true)).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledWith(12, {
      type: AGENT_INDICATOR_SET_MESSAGE,
      active: true,
    });
  });
});
