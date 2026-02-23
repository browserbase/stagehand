/**
 * Internal-only errors for the shutdown supervisor.
 */

export class ShutdownSupervisorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShutdownSupervisorError";
  }
}

export class ShutdownSupervisorResolveError extends ShutdownSupervisorError {
  constructor(message: string) {
    super(message);
    this.name = "ShutdownSupervisorResolveError";
  }
}

export class ShutdownSupervisorSpawnError extends ShutdownSupervisorError {
  constructor(message: string) {
    super(message);
    this.name = "ShutdownSupervisorSpawnError";
  }
}
