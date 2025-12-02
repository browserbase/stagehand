import { Stagehand } from "@browserbasehq/stagehand";
import type { Page } from "@browserbasehq/stagehand";

/**
 * CUA Action Types - Browser primitives that can be executed
 */
export type ActionType =
  | "click"
  | "double_click"
  | "doubleClick"
  | "tripleClick"
  | "type"
  | "keypress"
  | "scroll"
  | "drag"
  | "move"
  | "goto"
  | "back"
  | "forward"
  | "wait"
  | "screenshot";

/**
 * Action Request - Sent by external agent to execute a browser primitive
 */
export interface ActionRequest {
  type: ActionType;
  // Mouse/click params
  x?: number;
  y?: number;
  button?: "left" | "right" | "middle";
  clickCount?: number;
  // Type/keyboard params
  text?: string;
  keys?: string | string[];
  // Scroll params
  scroll_x?: number;
  scroll_y?: number;
  // Navigation params
  url?: string;
  // Wait params
  timeMs?: number;
  // Drag params
  path?: Array<{ x: number; y: number }>;
}

/**
 * Viewport dimensions
 */
export interface Viewport {
  width: number;
  height: number;
}

/**
 * Browser State - Full state returned after each action
 */
export interface BrowserState {
  screenshot: string; // base64 PNG
  url: string;
  viewport: Viewport;
}

/**
 * Action Execution Result - Internal result from action executor
 */
export interface ActionExecutionResult {
  success: boolean;
  error?: string;
}

/**
 * Action Response - Full response sent back to external agent
 */
export interface ActionResponse {
  success: boolean;
  error?: string;
  state: BrowserState;
}

/**
 * Session Create Request
 */
export interface SessionCreateRequest {
  env?: "LOCAL" | "BROWSERBASE";
  browserbaseApiKey?: string;
  browserbaseProjectId?: string;
  viewport?: Viewport;
}

/**
 * Session Create Response
 */
export interface SessionCreateResponse {
  sessionId: string;
  state: BrowserState;
}

/**
 * Browser Session - Internal representation of an active session
 */
export interface BrowserSession {
  id: string;
  stagehand: Stagehand;
  page: Page;
  createdAt: Date;
}

/**
 * Error Response
 */
export interface ErrorResponse {
  error: string;
  code: string;
}
