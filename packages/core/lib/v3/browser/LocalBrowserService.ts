import type { LaunchedChrome } from "chrome-launcher";

import { launchLocalChrome } from "../launch/local";
import { StagehandInvalidArgumentError } from "../types/public/sdkErrors";
import {
  BrowserDisconnectOrClose,
  BrowserLaunchOrConnect,
  type BrowserLaunchOrConnectPayload,
  type BrowserLaunchOrConnectResult,
} from "../types/public/events";
import { BaseBrowserService } from "./BaseBrowserService";

export class LocalBrowserService extends BaseBrowserService {
  private chrome: LaunchedChrome | null = null;
  private pid: number | null = null;
  private ws: string | null = null;

  protected async on_BrowserLaunchOrConnect(
    event: ReturnType<typeof BrowserLaunchOrConnect>,
  ): Promise<BrowserLaunchOrConnectResult> {
    const payload = event as unknown as BrowserLaunchOrConnectPayload;

    if (payload.CdpUrl) {
      this.ws = payload.CdpUrl;
      this.chrome = null;
      this.pid = null;
      return { Ws: payload.CdpUrl, Launched: false, Pid: null };
    }

    if (this.ws && this.chrome) {
      return { Ws: this.ws, Launched: true, Pid: this.pid };
    }

    if (!payload.LaunchOptions) {
      throw new StagehandInvalidArgumentError(
        "BrowserLaunchOrConnect requires either CdpUrl or LaunchOptions",
      );
    }

    const launch = await launchLocalChrome({
      chromePath: payload.LaunchOptions.ChromePath,
      chromeFlags: payload.LaunchOptions.ChromeFlags,
      port: payload.LaunchOptions.Port,
      headless: payload.LaunchOptions.Headless,
      userDataDir: payload.LaunchOptions.UserDataDir,
      connectTimeoutMs: payload.LaunchOptions.ConnectTimeoutMs,
      handleSIGINT: payload.LaunchOptions.HandleSIGINT,
    });

    this.chrome = launch.chrome;
    this.ws = launch.ws;
    this.pid = launch.chrome.process?.pid ?? launch.chrome.pid ?? null;

    if (payload.LaunchOptions.UnrefProcess) {
      try {
        this.chrome.process?.unref?.();
      } catch {
        // best-effort only
      }
    }

    return { Ws: launch.ws, Launched: true, Pid: this.pid };
  }

  protected async on_BrowserDisconnectOrClose(
    _event: ReturnType<typeof BrowserDisconnectOrClose>,
  ): Promise<void> {
    if (this.chrome) {
      try {
        await this.chrome.kill();
      } catch {
        // best-effort only
      }
    }

    if (this.pid) {
      try {
        process.kill(this.pid);
      } catch {
        // best-effort only
      }
    }

    this.chrome = null;
    this.pid = null;
    this.ws = null;
  }
}
