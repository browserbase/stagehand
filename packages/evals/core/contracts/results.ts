export type EnvironmentName = "local" | "browserbase";

export type BrowserOwnership = "runner" | "tool";

export type ConnectionMode =
  | "launch"
  | "attach_ws"
  | "attach_http"
  | "browserbase_native";

export interface Artifact {
  name: string;
  type: "text" | "json" | "image" | "binary";
  path?: string;
  data?: Buffer | string;
  mimeType?: string;
}
