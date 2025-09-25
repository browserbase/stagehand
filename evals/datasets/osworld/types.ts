export interface OSWorldTask {
  id: string;
  snapshot: string;
  instruction: string;
  source: string;
  config: OSWorldConfig[];
  trajectory: string;
  related_apps: string[];
  evaluator: OSWorldEvaluator;
  proxy: boolean;
  fixed_ip: boolean;
  possibility_of_env_change: "low" | "medium" | "high";
}

export interface OSWorldConfig {
  type: string;
  parameters: Record<string, unknown>;
}

export interface OSWorldEvaluator {
  func: string | string[];
  result: OSWorldResult | OSWorldResult[];
  expected: OSWorldExpected | OSWorldExpected[];
  postconfig?: OSWorldConfig[];
}

export interface OSWorldResult {
  type: string;
  goto_prefix?: string;
  parse_keys?: string[];
  category?: string;
  class_multiObject_search_exist?: Record<string, unknown>;
}

export interface OSWorldExpected {
  type: string;
  rules?: OSWorldRule;
}

export interface OSWorldRule {
  type?: string;
  url?: string;
  expected?: Record<string, unknown> | string;
  expect_in_result?: boolean;
}

export interface OSWorldStagehandTask {
  id: string;
  instruction: string;
  source: string;
  startUrl?: string;
  evaluationType: "url_match" | "string_match" | "dom_state" | "custom";
  evaluationCriteria: {
    type: string;
    expected: unknown;
    rules?: OSWorldRule;
  };
  timeout?: number;
  requiresProxy: boolean;
}
