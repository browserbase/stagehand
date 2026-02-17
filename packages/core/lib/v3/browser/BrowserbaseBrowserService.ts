import type Browserbase from "@browserbasehq/sdk";

import { createBrowserbaseSession } from "../launch/browserbase";
import { StagehandInvalidArgumentError } from "../types/public/sdkErrors";
import {
  USDisconnectOrCloseBrowserEvent,
  USLaunchOrConnectBrowserEvent,
  type USLaunchOrConnectBrowserPayload,
  type USLaunchOrConnectBrowserResult,
} from "../types/public/events";
import type { BrowserbaseSessionCreateParams } from "../types/public/api";
import { BaseBrowserService } from "./BaseBrowserService";

export class BrowserbaseBrowserService extends BaseBrowserService {
  private bb: Browserbase | null = null;
  private sessionId: string | null = null;
  private ws: string | null = null;

  getBrowserbaseClient(): Browserbase | null {
    return this.bb;
  }

  protected async on_BrowserLaunchOrConnect(
    event: ReturnType<typeof USLaunchOrConnectBrowserEvent>,
  ): Promise<USLaunchOrConnectBrowserResult> {
    const payload = event as unknown as USLaunchOrConnectBrowserPayload;
    const options = payload.BrowserbaseOptions;

    if (!options) {
      if (payload.CdpUrl) {
        this.ws = payload.CdpUrl;
        return { Ws: payload.CdpUrl, Launched: false, Pid: null };
      }

      if (this.ws) {
        return {
          Ws: this.ws,
          Launched: false,
          Pid: null,
          SessionId: this.sessionId ?? undefined,
        };
      }

      throw new StagehandInvalidArgumentError(
        "BrowserbaseBrowserService requires BrowserbaseOptions for USLaunchOrConnectBrowserEvent",
      );
    }

    const created = await createBrowserbaseSession(
      options.ApiKey,
      options.ProjectId,
      options.SessionCreateParams as BrowserbaseSessionCreateParams | undefined,
      options.SessionId,
    );

    this.bb = created.bb;
    this.sessionId = created.sessionId;
    this.ws = created.ws;

    return {
      Ws: created.ws,
      Launched: !options.SessionId,
      Pid: null,
      SessionId: created.sessionId,
    };
  }

  protected async on_BrowserDisconnectOrClose(
    _event: ReturnType<typeof USDisconnectOrCloseBrowserEvent>,
  ): Promise<void> {
    this.bb = null;
    this.sessionId = null;
    this.ws = null;
  }
}
