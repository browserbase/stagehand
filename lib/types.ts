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
