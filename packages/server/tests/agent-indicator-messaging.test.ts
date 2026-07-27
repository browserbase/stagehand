import { describe, expect, it, vi } from "vitest";
import { AGENT_INDICATOR_SET_MESSAGE } from "../agentIndicatorMessages.ts";
import {
  createAgentIndicatorBootstrapGuard,
  handleAgentIndicatorSetMessage,
} from "../dom/agentIndicatorMessaging.ts";

describe("agent indicator content-script messaging", () => {
  it("does not apply a stale bootstrap response after a SET message", () => {
    const setActive = vi.fn(() => true);
    const guard = createAgentIndicatorBootstrapGuard();

    guard.markSetReceived();

    expect(guard.apply(false, setActive)).toBe(false);
    expect(setActive).not.toHaveBeenCalled();
  });

  it("applies the bootstrap response when no SET message arrived", () => {
    const setActive = vi.fn(() => true);
    const guard = createAgentIndicatorBootstrapGuard();

    expect(guard.apply(true, setActive)).toBe(true);
    expect(setActive).toHaveBeenCalledWith(true);
  });

  it("ignores messages that are not well-formed indicator updates", () => {
    const setActive = vi.fn();
    const respondAfterPaint = vi.fn();
    const sendResponse = vi.fn();

    for (const message of [
      null,
      { type: "unrelated", active: true },
      { type: AGENT_INDICATOR_SET_MESSAGE },
    ]) {
      expect(
        handleAgentIndicatorSetMessage(
          message,
          AGENT_INDICATOR_SET_MESSAGE,
          setActive,
          respondAfterPaint,
          sendResponse,
        ),
      ).toBeUndefined();
    }

    expect(setActive).not.toHaveBeenCalled();
    expect(respondAfterPaint).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });

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
