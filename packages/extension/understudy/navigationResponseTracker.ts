import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp.js";
import type { Page } from "./page.js";
import { Response } from "./response.js";

export class NavigationResponseTracker {
  readonly page: Page;
  readonly session: CDPSessionLike;
  readonly navigationCommandId: number;

  expectedLoaderId: string | undefined;
  selectedRequestId: string | null = null;
  selectedResponse: Response | null = null;
  acceptNextWithoutLoader = false;

  responseResolved = false;
  resolveResponse!: (value: Response | null) => void;
  responsePromise: Promise<Response | null>;

  readonly pendingResponsesByLoader = new Map<string, Protocol.Network.ResponseReceivedEvent>();
  readonly pendingExtraInfo = new Map<string, Protocol.Network.ResponseReceivedExtraInfoEvent>();

  readonly listeners: Array<{
    event: string;
    handler: (event: unknown) => void;
  }> = [];

  constructor(params: { page: Page; session: CDPSessionLike; navigationCommandId: number }) {
    this.page = params.page;
    this.session = params.session;
    this.navigationCommandId = params.navigationCommandId;

    this.responsePromise = new Promise<Response | null>((resolve) => {
      this.resolveResponse = (value) => {
        if (this.responseResolved) return;
        this.responseResolved = true;
        resolve(value);
      };
    });

    this.installListeners();
  }

  public dispose(): void {
    for (const { event, handler } of this.listeners) {
      this.session.off(event, handler as never);
    }
    this.listeners.length = 0;
    this.pendingResponsesByLoader.clear();
    this.pendingExtraInfo.clear();
  }

  /**
   * Hint the tracker with the loader id returned by `Page.navigate`. Chrome only
   * emits this once the browser begins navigating, so we store early responses
   * and match them once the loader id is known.
   */
  public setExpectedLoaderId(loaderId: string | undefined): void {
    if (!loaderId) return;
    this.expectedLoaderId = loaderId;
    const pending = this.pendingResponsesByLoader.get(loaderId);
    if (pending) {
      this.pendingResponsesByLoader.delete(loaderId);
      this.selectResponse(pending);
    }
  }

  /**
   * Some navigation APIs (reload/history traversal) do not provide a loader id
   * up front. Select a qualifying response that arrived before the command
   * resolved, or accept the next one if no response has arrived yet.
   */
  public expectNavigationWithoutKnownLoader(): void {
    if (this.responseResolved) return;

    const pending = this.pendingResponsesByLoader.values().next().value;
    if (pending) {
      this.selectResponse(pending);
      return;
    }

    this.acceptNextWithoutLoader = true;
  }

  public async navigationCompleted(): Promise<Response | null> {
    if (!this.responseResolved) {
      queueMicrotask(() => {
        if (!this.responseResolved) this.resolveResponse(null);
      });
    }
    return this.responsePromise;
  }

  public async response(): Promise<Response | null> {
    return this.responsePromise;
  }

  installListeners(): void {
    this.addListener("Network.responseReceived", (event) => {
      this.onResponseReceived(event as Protocol.Network.ResponseReceivedEvent);
    });
    this.addListener("Network.responseReceivedExtraInfo", (event) => {
      this.onResponseReceivedExtraInfo(event as Protocol.Network.ResponseReceivedExtraInfoEvent);
    });
  }

  addListener(event: string, handler: (event: unknown) => void): void {
    this.session.on(event, handler as never);
    this.listeners.push({ event, handler });
  }

  onResponseReceived(event: Protocol.Network.ResponseReceivedEvent): void {
    if (!this.page.isCurrentNavigationCommand(this.navigationCommandId)) return;
    if (!event || !event.response) return;
    if (event.type !== "Document") return;
    if (event.frameId !== this.page.mainFrameId()) return;

    const loaderId = event.loaderId ?? "";
    if (this.acceptNextWithoutLoader) {
      this.acceptNextWithoutLoader = false;
      this.selectResponse(event);
      return;
    }

    if (this.expectedLoaderId) {
      if (loaderId && loaderId !== this.expectedLoaderId) {
        this.pendingResponsesByLoader.set(loaderId, event);
        return;
      }
      this.selectResponse(event);
      return;
    }

    if (loaderId) {
      this.pendingResponsesByLoader.set(loaderId, event);
      return;
    }

    this.selectResponse(event);
  }

  onResponseReceivedExtraInfo(event: Protocol.Network.ResponseReceivedExtraInfoEvent): void {
    if (!event || !event.requestId) return;
    if (this.selectedRequestId && event.requestId === this.selectedRequestId) return;
    this.pendingExtraInfo.set(event.requestId, event);
  }

  selectResponse(event: Protocol.Network.ResponseReceivedEvent): void {
    if (event.loaderId) {
      this.pendingResponsesByLoader.delete(event.loaderId);
    }

    if (this.responseResolved) return;
    if (this.selectedResponse) return;

    const protocol = event.response?.protocol?.toLowerCase() ?? "";
    const url = event.response?.url ?? "";
    const isDataUrl = protocol === "data" || url.startsWith("data:");
    const isAboutUrl = protocol === "about" || url.startsWith("about:");

    if (isDataUrl || isAboutUrl) {
      this.pendingExtraInfo.delete(event.requestId);
      this.selectedRequestId = null;
      this.selectedResponse = null;
      this.resolveResponse(null);
      return;
    }

    const response = new Response({
      page: this.page,
      session: this.session,
      requestId: event.requestId,
      frameId: event.frameId,
      loaderId: event.loaderId,
      response: event.response,
      fromServiceWorker: Boolean(event.response?.fromServiceWorker),
    });

    this.selectedRequestId = event.requestId;
    this.selectedResponse = response;

    // Redirect hops share the request id, so the stored extra info may belong
    // to a 3xx hop rather than this response.
    const extraInfo = this.pendingExtraInfo.get(event.requestId);
    this.pendingExtraInfo.delete(event.requestId);
    if (extraInfo && extraInfo.statusCode === event.response?.status) {
      response.applyExtraInfo(extraInfo);
    }

    this.resolveResponse(response);
  }
}
