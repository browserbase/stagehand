import { EventBus, retry } from "../bubus";
import type { LaunchedChrome } from "chrome-launcher";
import { launchLocalChrome } from "../launch/local";
import {
  USDisconnectOrCloseBrowserEvent,
  USLaunchOrConnectBrowserEvent,
  type USLaunchOrConnectBrowserPayload,
  type USLaunchOrConnectBrowserResult,
} from "../types/public/events";
import { StagehandInvalidArgumentError } from "../types/public/sdkErrors";

const LOCAL_BROWSER_LAUNCH_TIMEOUT = 90;
const LOCAL_BROWSER_LAUNCH_MAX_ATTEMPTS = 3;

export class UnderstudyBrowserLifecycleService {
  private readonly bus: EventBus;
  private chrome: LaunchedChrome | null = null;
  private pid: number | null = null;
  private ws: string | null = null;

  constructor(bus: EventBus) {
    this.bus = bus;
    this.bus.on(
      USLaunchOrConnectBrowserEvent,
      retry({
        timeout: LOCAL_BROWSER_LAUNCH_TIMEOUT,
        max_attempts: LOCAL_BROWSER_LAUNCH_MAX_ATTEMPTS,
        semaphore_limit: 5,
        semaphore_scope: "global",
        semaphore_name: "local-browser-launching",
        semaphore_timeout: 30,
      })(this.onLaunchOrConnectBrowserEvent.bind(this)),
    );
    this.bus.on(
      USDisconnectOrCloseBrowserEvent,
      retry({ timeout: 10, max_attempts: 2 })(
        this.onDisconnectOrCloseBrowserEvent.bind(this),
      ),
    );
  }

  private async onLaunchOrConnectBrowserEvent(
    event: ReturnType<typeof USLaunchOrConnectBrowserEvent>,
  ): Promise<USLaunchOrConnectBrowserResult> {
    const payload = event as unknown as USLaunchOrConnectBrowserPayload;

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
        "USLaunchOrConnectBrowserEvent requires either CdpUrl or LaunchOptions",
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

  private async onDisconnectOrCloseBrowserEvent(
    _event: ReturnType<typeof USDisconnectOrCloseBrowserEvent>,
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
