import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp.js";

type SessionNetworkEvents = {
  "Network.requestWillBeSent": Protocol.Network.RequestWillBeSentEvent;
  "Network.loadingFinished": Protocol.Network.LoadingFinishedEvent;
  "Network.loadingFailed": Protocol.Network.LoadingFailedEvent;
  "Network.requestServedFromCache": Protocol.Network.RequestServedFromCacheEvent;
  "Network.responseReceived": Protocol.Network.ResponseReceivedEvent;
  "Page.frameStoppedLoading": Protocol.Page.FrameStoppedLoadingEvent;
};

export type SessionNetworkHandlers = {
  [Event in keyof SessionNetworkEvents]: (
    event: SessionNetworkEvents[Event],
    receivedAt: number,
  ) => void;
};

/**
 * Captures one session's network events independently of page ownership.
 * Listeners are installed immediately; domain enablement belongs to the caller.
 * Events retain their arrival time and are buffered until a single consumer attaches.
 * The owner must dispose the capture when the session is no longer needed.
 */
export class SessionNetworkCapture {
  private readonly pending: Array<(handlers: SessionNetworkHandlers) => void> = [];
  private readonly removeListeners: Array<() => void> = [];
  private handlers?: SessionNetworkHandlers;
  private draining = false;
  private disposed = false;

  constructor(readonly session: CDPSessionLike) {
    try {
      this.listen("Network.requestWillBeSent");
      this.listen("Network.loadingFinished");
      this.listen("Network.loadingFailed");
      this.listen("Network.requestServedFromCache");
      this.listen("Network.responseReceived");
      this.listen("Page.frameStoppedLoading");
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /** Deliver buffered events in order, then continue with live events. */
  attach(handlers: SessionNetworkHandlers): void {
    if (this.disposed) throw new Error("Session network capture is disposed");
    if (this.handlers) throw new Error("Session network capture already has a consumer");
    this.handlers = handlers;
    this.drain();
  }

  /** Stop capturing and release both buffered events and the consumer. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const remove of this.removeListeners) remove();
    this.removeListeners.length = 0;
    this.pending.length = 0;
    this.handlers = undefined;
  }

  private listen<Event extends keyof SessionNetworkEvents>(name: Event): void {
    const listener = (event: SessionNetworkEvents[Event]) => {
      if (this.disposed) return;
      const receivedAt = Date.now();
      this.pending.push((handlers) => handlers[name](event, receivedAt));
      this.drain();
    };
    this.session.on(name, listener);
    this.removeListeners.push(() => this.session.off(name, listener));
  }

  private drain(): void {
    const handlers = this.handlers;
    if (!handlers || this.draining || this.disposed) return;
    this.draining = true;
    let delivered = 0;
    try {
      // Events arriving during delivery join the tail, behind older buffered events.
      while (!this.disposed && delivered < this.pending.length) {
        this.pending[delivered++]!(handlers);
      }
    } finally {
      this.pending.splice(0, delivered);
      this.draining = false;
    }
  }
}
