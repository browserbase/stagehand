import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp.js";

type SessionNetworkEvents = {
  "Network.requestWillBeSent": Protocol.Network.RequestWillBeSentEvent;
  "Network.loadingFinished": Protocol.Network.LoadingFinishedEvent;
  "Network.loadingFailed": Protocol.Network.LoadingFailedEvent;
  "Network.requestServedFromCache": Protocol.Network.RequestServedFromCacheEvent;
  "Network.responseReceived": Protocol.Network.ResponseReceivedEvent;
  "Page.frameStoppedLoading": Protocol.Page.FrameStoppedLoadingEvent;
  "Page.frameNavigated": Protocol.Page.FrameNavigatedEvent;
};

export type SessionNetworkHandlers = {
  [Event in keyof SessionNetworkEvents]: (
    event: SessionNetworkEvents[Event],
    receivedAt: number,
  ) => void;
};

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
      this.listen("Page.frameNavigated");
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  attach(handlers: SessionNetworkHandlers): void {
    if (this.disposed) throw new Error("Session network capture is disposed");
    if (this.handlers) throw new Error("Session network capture already has a consumer");
    this.handlers = handlers;
    this.drain();
  }

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
      while (!this.disposed && delivered < this.pending.length) {
        this.pending[delivered++]!(handlers);
      }
    } finally {
      this.pending.splice(0, delivered);
      this.draining = false;
    }
  }
}
