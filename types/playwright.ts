export class PlaywrightCommandException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaywrightCommandException";
  }
}

export class PlaywrightCommandMethodNotSupportedException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaywrightCommandMethodNotSupportedException";
  }
}

export interface GotoOptions {
  timeout?: number;
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  referer?: string;
}
