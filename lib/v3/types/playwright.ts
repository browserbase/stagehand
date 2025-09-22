export interface GotoOptions {
  timeout?: number;
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  referer?: string;
  frameId?: string;
}
