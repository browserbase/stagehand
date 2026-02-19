/**
 * Internal-only types for the shutdown supervisor process.
 */

export type ShutdownSupervisorConfig =
  | {
      kind: "LOCAL";
      pid: number;
      userDataDir?: string;
      createdTempProfile?: boolean;
      preserveUserDataDir?: boolean;
    }
  | {
      kind: "STAGEHAND_API";
      sessionId: string;
      apiKey: string;
      projectId: string;
    };

export interface ShutdownSupervisorHandle {
  /** Best-effort signal to stop the supervisor process. */
  stop: () => void;
}
