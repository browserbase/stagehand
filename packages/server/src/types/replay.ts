export interface StagehandReplay {
  pages: StagehandReplayPage[];
  clientLanguage?: string;
}

export interface StagehandReplayPage {
  url: string;
  duration: number;
  timestamp: number;
  actions: StagehandReplayAction[];
}

export interface StagehandReplayAction {
  method: string;
  parameters: Record<string, unknown>;
  result: Record<string, unknown>;
  timestamp: number;
  endTime?: number;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    timeMs: number;
    cost?: number;
  };
}
