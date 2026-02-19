/**
 * Internal-only types for the shutdown supervisor process.
 */

export type ShutdownSupervisorConfig =
  | {
      kind: "LOCAL";
      keepAlive: boolean;
      pid: number;
      userDataDir?: string;
      createdTempProfile?: boolean;
      preserveUserDataDir?: boolean;
    }
  | {
      kind: "STAGEHAND_API";
      keepAlive: boolean;
      sessionId: string;
      apiKey: string;
      projectId: string;
    };

export type ShutdownSupervisorMessage =
  | { type: "exit" }
  | { type: "ready" };

export interface ShutdownSupervisorHandle {
  /** Best-effort signal to stop the supervisor without running cleanup. */
  stop: () => void;
  /** Resolves once the supervisor acknowledges config or times out. */
  ready: Promise<void>;
}
