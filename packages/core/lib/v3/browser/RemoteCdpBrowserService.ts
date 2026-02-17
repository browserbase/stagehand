import { StagehandInvalidArgumentError } from "../types/public/sdkErrors";
import {
  BrowserDisconnectOrClose,
  BrowserLaunchOrConnect,
  type BrowserLaunchOrConnectPayload,
  type BrowserLaunchOrConnectResult,
} from "../types/public/events";
import { BaseBrowserService } from "./BaseBrowserService";

export class RemoteCdpBrowserService extends BaseBrowserService {
  private ws: string | null = null;

  protected async on_BrowserLaunchOrConnect(
    event: ReturnType<typeof BrowserLaunchOrConnect>,
  ): Promise<BrowserLaunchOrConnectResult> {
    const payload = event as unknown as BrowserLaunchOrConnectPayload;

    if (payload.CdpUrl) {
      this.ws = payload.CdpUrl;
      return { Ws: payload.CdpUrl, Launched: false, Pid: null };
    }

    if (this.ws) {
      return { Ws: this.ws, Launched: false, Pid: null };
    }

    throw new StagehandInvalidArgumentError(
      "RemoteCdpBrowserService requires CdpUrl for BrowserLaunchOrConnect",
    );
  }

  protected async on_BrowserDisconnectOrClose(
    _event: ReturnType<typeof BrowserDisconnectOrClose>,
  ): Promise<void> {
    this.ws = null;
  }
}
