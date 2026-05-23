export interface ClawBenchEvalSchema {
  url_pattern: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
  params?: Record<string, unknown>;
}

export interface ClawBenchTaskMetadata {
  task_id?: number;
  metaclass?: string;
  class?: string;
  description?: string;
  sites_involved?: string[];
  platform?: string;
  [key: string]: unknown;
}

export interface ClawBenchExtraInfo {
  path?: string;
  description: string;
}

export interface ClawBenchTaskData {
  metadata?: ClawBenchTaskMetadata;
  instruction: string;
  eval_schema: ClawBenchEvalSchema;
  time_limit: number;
  extra_info?: ClawBenchExtraInfo[] | ClawBenchExtraInfo | string;
  judge_context?: Record<string, unknown>;
}

export interface ClawBenchCase {
  corpus: string;
  caseName: string;
  taskFile: string;
  taskDir: string;
  task: ClawBenchTaskData;
}

export interface ClawBenchRunParams {
  corpus: string;
  caseName: string;
  taskFile: string;
  taskDir: string;
  taskId?: number;
  instruction: string;
  evalSchema: ClawBenchEvalSchema;
  timeLimitMinutes: number;
  metadata?: ClawBenchTaskMetadata;
  extraInfo?: ClawBenchExtraInfo[];
  judgeContext?: Record<string, unknown>;
}

export interface ClawBenchModelConfig {
  model: string;
  base_url: string;
  api_type:
    | "anthropic-messages"
    | "openai-responses"
    | "openai-completions"
    | "google-generative-ai";
  api_key?: string;
  api_keys?: string[];
  thinking_level?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface ClawBenchJudgeVerdict {
  match: boolean | null;
  reason: string;
  judge_model: string;
  raw?: string | null;
  error?: string | null;
  rubric?: string;
}
