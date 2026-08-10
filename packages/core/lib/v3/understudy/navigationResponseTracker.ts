/**
 * NavigationResponseTracker
 * -------------------------
 *
 * Tracks DevTools Protocol network events for a single navigation command so
 * Stagehand can surface a Playwright-like response object from `Page.goto` and
 * related APIs. The tracker listens for `Network.responseReceived` events that
 * correspond to the targeted document navigation, handles loader-id churn that
 * arises from redirects or preloading, and enriches the resulting
 * `Response` with extra header information. It also observes
 * `Network.loadingFinished` / `Network.loadingFailed` to fulfil the
 * `response.finished()` contract exposed to consumers.
 */

import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp.js";
import type { Page } from "./page.js";
import { Response } from "./response.js";

/**
 * Watches CDP events on a given session and resolves with the navigation's
 * primary document response once identified.
 */
export class NavigationResponseTracker {
  private readonly page: Page;
  private readonly session: CDPSessionLike;
  private readonly navigationCommandId: number;

  private expectedLoaderId: string | undefined;
  private selectedRequestId: string | null = null;
  private selectedResponse: Response | null = null;
  private acceptNextWithoutLoader = false;

  private responseResolved = false;
  private resolveResponse!: (value: Response | null) => void;
  private responsePromise: Promise<Response | null>;

  private readonly pendingResponsesByLoader = new Map<
    string,
    Protocol.Network.ResponseReceivedEvent
  >();
  private readonly pendingExtraInfo = new Map<
    string,
    Protocol.Network.ResponseReceivedExtraInfoEvent
  >();

  private readonly listeners: Array<{
    event: string;
    handler: (event: unknown) => void;
  }> = [];

  /**
   * Create a tracker bound to a specific navigation command. The tracker begins
   * listening for network events immediately so it should be constructed before
   * the navigation request is dispatched.
   */
  constructor(params: {
    page: Page;
    session: CDPSessionLike;
    navigationCommandId: number;
  }) {
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

  /** Stop listening for CDP events and release any pending bookkeeping. */
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
   * up front. This flag instructs the tracker to accept the next qualifying
   * document response even if no loader id has been announced yet.
   */
  public expectNavigationWithoutKnownLoader(): void {
    this.acceptNextWithoutLoader = true;
  }

  /**
   * Returns a promise that resolves with the matched response (or `null` when
   * no document response was observed).
   */
  public async navigationCompleted(): Promise<Response | null> {
    if (!this.responseResolved) {
      queueMicrotask(() => {
        if (!this.responseResolved) this.resolveResponse(null);
      });
    }
    return this.responsePromise;
  }

  /** Expose the raw response promise (mainly for tests). */
  public async response(): Promise<Response | null> {
    return this.responsePromise;
  }

  /** Register all CDP listeners relevant to navigation tracking. */
  private installListeners(): void {
    this.addListener("Network.responseReceived", (event) => {
      this.onResponseReceived(event as Protocol.Network.ResponseReceivedEvent);
    });
    this.addListener("Network.responseReceivedExtraInfo", (event) => {
      this.onResponseReceivedExtraInfo(
        event as Protocol.Network.ResponseReceivedExtraInfoEvent,
      );
    });
    this.addListener("Network.loadingFinished", (event) => {
      this.onLoadingFinished(event as Protocol.Network.LoadingFinishedEvent);
    });
    this.addListener("Network.loadingFailed", (event) => {
      this.onLoadingFailed(event as Protocol.Network.LoadingFailedEvent);
    });
  }

  /** Attach a CDP listener and track it for later disposal. */
  private addListener(event: string, handler: (event: unknown) => void): void {
    this.session.on(event, handler as never);
    this.listeners.push({ event, handler });
  }

  /** Handle the initial response payload for document navigations. */
  private onResponseReceived(
    event: Protocol.Network.ResponseReceivedEvent,
  ): void {
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

  /** Merge auxiliary header information once Chrome exposes it. */
  private onResponseReceivedExtraInfo(
    event: Protocol.Network.ResponseReceivedExtraInfoEvent,
  ): void {
    if (!event || !event.requestId) return;
    if (this.selectedRequestId && event.requestId === this.selectedRequestId) {
      this.selectedResponse?.applyExtraInfo(event);
      return;
    }
    this.pendingExtraInfo.set(event.requestId, event);
  }

  /** Resolve the response's finished promise when the request completes. */
  private onLoadingFinished(
    event: Protocol.Network.LoadingFinishedEvent,
  ): void {
    if (!event || !event.requestId) return;
    if (event.requestId !== this.selectedRequestId) return;
    this.selectedResponse?.markFinished(null);
  }

  /** Resolve the response's finished promise with an error on failure. */
  private onLoadingFailed(event: Protocol.Network.LoadingFailedEvent): void {
    // Ignore malformed events or ones without a request id
    if (!event || !event.requestId) return;
    // Only the tracked document request should toggle the response state
    if (event.requestId !== this.selectedRequestId) return;
    // Surface Chrome's failure text through response.finished()
    const errorText = event.errorText || "Navigation request failed";
    this.selectedResponse?.markFinished(new Error(errorText));
  }

  /**
   * Create the `Response` wrapper for the chosen document response and
   * resolve awaiting consumers. Subsequent events flesh out the header/body
   * helpers and mark the request as finished.
   */
  private selectResponse(event: Protocol.Network.ResponseReceivedEvent): void {
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

    const extraInfo = this.pendingExtraInfo.get(event.requestId);
    if (extraInfo) {
      response.applyExtraInfo(extraInfo);
      this.pendingExtraInfo.delete(event.requestId);
    }

    this.resolveResponse(response);
  }
}
