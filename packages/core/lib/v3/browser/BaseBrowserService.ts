import { EventBus, retry } from "../bubus";
import {
  BrowserDisconnectOrClose,
  BrowserLaunchOrConnect,
} from "../types/public/events";

const LOCAL_BROWSER_LAUNCH_TIMEOUT = 90;
const LOCAL_BROWSER_LAUNCH_MAX_ATTEMPTS = 3;

export abstract class BaseBrowserService {
  protected readonly bus: EventBus;

  constructor(bus: EventBus) {
    this.bus = bus;
    this.bus.on(
      BrowserLaunchOrConnect,
      retry({
        timeout: LOCAL_BROWSER_LAUNCH_TIMEOUT,
        max_attempts: LOCAL_BROWSER_LAUNCH_MAX_ATTEMPTS,
        semaphore_limit: 5,
        semaphore_scope: "global",
        semaphore_name: "local-browser-launching",
        semaphore_timeout: 30,
      })(this.on_BrowserLaunchOrConnect.bind(this)),
    );
    this.bus.on(
      BrowserDisconnectOrClose,
      retry({ timeout: 10, max_attempts: 2 })(
        this.on_BrowserDisconnectOrClose.bind(this),
      ),
    );
  }

  protected abstract on_BrowserLaunchOrConnect(
    event: ReturnType<typeof BrowserLaunchOrConnect>,
  ): Promise<unknown>;

  protected abstract on_BrowserDisconnectOrClose(
    event: ReturnType<typeof BrowserDisconnectOrClose>,
  ): Promise<void>;
}
