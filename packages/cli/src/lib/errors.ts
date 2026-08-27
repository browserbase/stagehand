export interface CommandFailureTelemetry {
  resultCode?: string;
  httpStatus?: number;
  requestHadHttpResponse?: boolean;
}

export class CommandFailure extends Error {
  readonly exitCode: number;
  readonly telemetry: CommandFailureTelemetry;

  constructor(
    message: string,
    exitCode = 1,
    telemetry: CommandFailureTelemetry = {},
  ) {
    super(message);
    this.name = "CommandFailure";
    this.exitCode = exitCode;
    this.telemetry = telemetry;
  }
}

export function fail(
  message: string,
  exitCode = 1,
  telemetry: CommandFailureTelemetry = {},
): never {
  throw new CommandFailure(message, exitCode, telemetry);
}
