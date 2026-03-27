export type DatabaseJsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: DatabaseJsonValue }
  | DatabaseJsonValue[];

export interface LLMProviderOptions {
  temperature?: number;
  organization?: string;
  project?: string;
  location?: string;
}

export type ExtraHttpHeaders = Record<string, string>;
