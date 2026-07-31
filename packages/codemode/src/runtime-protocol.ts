import type {
  CodeLogEntry,
  CodePageState,
  RuntimeRunResult,
  RuntimeStatus,
  StagehandCodeRuntimeConfig,
} from "./types.js";

export type ChildRequest =
  | {
      id: string;
      type: "configure";
      codeSessionId: string;
      config: StagehandCodeRuntimeConfig;
    }
  | {
      id: string;
      type: "run";
      code: string;
      timeoutMs: number;
    }
  | {
      id: string;
      type: "status";
    }
  | {
      id: string;
      type: "reset";
    }
  | {
      id: string;
      type: "close";
    };

export type ChildResponse =
  | {
      id: string;
      ok: true;
      result?: RuntimeRunResult | RuntimeStatus | { closed: true } | { reset: true };
    }
  | {
      id: string;
      ok: false;
      error: {
        name: string;
        message: string;
        kind: "runtime" | "timeout" | "closed";
        retryable: boolean;
        mayHaveSideEffects: boolean;
        stack?: string;
      };
      page?: CodePageState;
      logs?: CodeLogEntry[];
    };
