export interface ActionMappingOptions {
  toolCallName: string;
  toolResult: unknown;
  args: Record<string, unknown>;
  reasoning?: string;
}
