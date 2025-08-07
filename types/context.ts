import type { BrowserContext as PlaywrightContext, Frame } from "playwright";
import { z } from "zod";
import { Page } from "../types/page";
import { LogLine } from "./log";
import { StagehandPage } from "../lib/StagehandPage";
import { LLMClient, ChatMessage } from "../lib/llm/LLMClient";
import { StagehandFunctionName } from "./stagehand";
import { LLMTool } from "./llm";

// Shared base types
export interface NodePropertyValue {
  type: string;
  value?: string;
}

export interface NodeProperty {
  name: string;
  value: NodePropertyValue;
}

// Base interface for LLM operation results
export interface LLMOperationUsage {
  prompt_tokens: number;
  completion_tokens: number;
  inference_time_ms: number;
}

export interface PromptCallData {
  type: string;
  messages: ChatMessage[];
  system: string;
  schema: unknown;
  config: unknown;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export interface InferencePromptData {
  calls: Array<PromptCallData>;
  requestId: string;
}

// Base interface for perform operation options
export interface BasePerformOptions {
  instruction: string;
  requestId: string;
  userProvidedInstructions?: string;
  iframes?: boolean;
}

// Base interface for perform operation results
export interface BasePerformResult extends LLMOperationUsage {
  promptData?: InferencePromptData;
}

// Common mapping types
export type EncodedIdMap = Record<EncodedId, string>;
export type StringMap = Record<string, string>;
export type NumberStringMap = Record<number, string>;

export interface AXNode {
  role?: { value: string };
  name?: { value: string };
  description?: { value: string };
  value?: { value: string };
  nodeId: string;
  backendDOMNodeId?: number;
  parentId?: string;
  childIds?: string[];
  properties?: NodeProperty[];
}

export type AccessibilityNode = {
  role: string;
  name?: string;
  description?: string;
  value?: string;
  children?: AccessibilityNode[];
  childIds?: string[];
  parentId?: string;
  nodeId?: string;
  backendDOMNodeId?: number;
  properties?: NodeProperty[];
};

export interface TreeResult {
  tree: AccessibilityNode[];
  simplified: string;
  iframes?: AccessibilityNode[];
  idToUrl: EncodedIdMap;
  xpathMap: EncodedIdMap;
}

export type DOMNode = {
  backendNodeId?: number;
  nodeName?: string;
  children?: DOMNode[];
  shadowRoots?: DOMNode[];
  contentDocument?: DOMNode;
  nodeType: number;
  frameId?: string;
};

export type BackendIdMaps = {
  tagNameMap: NumberStringMap;
  xpathMap: NumberStringMap;
  iframeXPath?: string;
};

export interface EnhancedContext
  extends Omit<PlaywrightContext, "newPage" | "pages"> {
  newPage(): Promise<Page>;
  pages(): Page[];
}

export type FrameId = string;
export type LoaderId = string;

export interface CdpFrame {
  id: FrameId;
  parentId?: FrameId;
  loaderId: LoaderId;
  name?: string;
  url: string;
  urlFragment?: string;
  domainAndRegistry?: string;
  securityOrigin: string;
  securityOriginDetails?: Record<string, unknown>;
  mimeType: string;
  unreachableUrl?: string;
  adFrameStatus?: string;
  secureContextType?: string;
  crossOriginIsolatedContextType?: string;
  gatedAPIFeatures?: string[];
}

export interface CdpFrameTree {
  frame: CdpFrame;
  childFrames?: CdpFrameTree[];
}

export interface FrameOwnerResult {
  backendNodeId?: number;
}

export interface CombinedA11yResult {
  combinedTree: string;
  combinedXpathMap: EncodedIdMap;
  combinedUrlMap: EncodedIdMap;
}

export interface FrameSnapshot {
  frame: Frame;
  tree: string;
  xpathMap: EncodedIdMap;
  urlMap: EncodedIdMap;
  frameXpath: string;
  backendNodeId: number | null;
  parentFrame?: Frame;
  /** CDP frame identifier for this snapshot; used to generate stable EncodedIds. */
  frameId?: string;
}

export type EncodedId = `${number}-${number}`;

export interface RichNode extends AccessibilityNode {
  encodedId?: EncodedId;
}

export const ID_PATTERN = /^\d+-\d+$/;

export interface ContextManagerConstructor {
  logger: (message: LogLine) => void;
  page: StagehandPage;
  llmClient: LLMClient;
}

// Internal types for ContextManager methods - NOT exported to end users
export interface BuildContextOptions {
  method: StagehandFunctionName;
  instruction: string;
  takeScreenshot?: boolean;
  includeAccessibilityTree?: boolean;
  tools?: Record<string, LLMTool>;
  appendToHistory?: boolean;
  iframes?: boolean;
  dynamic?: boolean;
}

export interface BuildContextResult {
  contextMessage: ChatMessage;
  allMessages: ChatMessage[];
  optimizedElements?: string;
  urlMapping?: StringMap;
  xpathMap?: StringMap;
}

export interface PerformExtractOptions<T extends z.ZodObject<z.ZodRawShape>>
  extends BasePerformOptions {
  schema: T;
  chunksSeen?: number;
  chunksTotal?: number;
  dynamic?: boolean;
}

export interface PerformExtractResult<T extends z.ZodObject<z.ZodRawShape>>
  extends BasePerformResult {
  data: z.infer<T>;
  metadata: {
    completed: boolean;
    progress: string;
  };
}

export interface PerformObserveOptions extends BasePerformOptions {
  returnAction?: boolean;
  dynamic?: boolean;
}

export interface ObservedElement {
  elementId: string;
  description: string;
  method?: string;
  arguments?: string[];
}

export interface PerformObserveResult extends BasePerformResult {
  elements: Array<ObservedElement>;
  xpathMapping: StringMap;
}
