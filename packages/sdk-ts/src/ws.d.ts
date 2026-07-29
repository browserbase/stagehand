declare module "ws" {
  export default class WebSocket extends EventTarget {
    static readonly CONNECTING: 0;
    static readonly OPEN: 1;
    static readonly CLOSING: 2;
    static readonly CLOSED: 3;

    constructor(url: string, options?: { headers?: Record<string, string> });

    readonly readyState: number;
    send(data: string): void;
    close(): void;
  }
}
