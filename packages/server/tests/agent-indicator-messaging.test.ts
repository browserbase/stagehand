import { describe, expect, it, vi } from "vitest";
import { AGENT_INDICATOR_SET_MESSAGE } from "../agentIndicatorMessages.ts";
import { handleAgentIndicatorSetMessage } from "../dom/agentIndicatorMessaging.ts";

describe("agent indicator content-script messaging", () => {
  it("does not report a paint when installation fails", () => {
    const respondAfterPaint = vi.fn();
    const sendResponse = vi.fn();

    expect(
      handleAgentIndicatorSetMessage(
        { type: AGENT_INDICATOR_SET_MESSAGE, active: true },
        AGENT_INDICATOR_SET_MESSAGE,
        () => false,
        respondAfterPaint,
        sendResponse,
      ),
    ).toBe(false);
    expect(respondAfterPaint).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ painted: false });
  });

  it("waits for paint only after activation succeeds", () => {
    const respondAfterPaint = vi.fn();
    const sendResponse = vi.fn();

    expect(
      handleAgentIndicatorSetMessage(
        { type: AGENT_INDICATOR_SET_MESSAGE, active: true },
        AGENT_INDICATOR_SET_MESSAGE,
        () => true,
        respondAfterPaint,
        sendResponse,
      ),
    ).toBe(true);
    expect(respondAfterPaint).toHaveBeenCalledWith(sendResponse);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
