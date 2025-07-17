import type { BrowserContext as PlaywrightContext, Frame } from "playwright";
import { Page } from "../types/page";

export interface AXNode {
  role?: { value: string };
  name?: { value: string };
  description?: { value: string };
  value?: { value: string };
  nodeId: string;
  backendDOMNodeId?: number;
  parentId?: string;
  childIds?: string[];
  properties?: {
    name: string;
    value: {
      type: string;
      value?: string;
    };
  }[];
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
  properties?: {
    name: string;
    value: {
      type: string;
      value?: string;
    };
  }[];
};

export interface TreeResult {
  tree: AccessibilityNode[];
  simplified: string;
  iframes?: AccessibilityNode[];
  idToUrl: Record<EncodedId, string>;
  xpathMap: Record<EncodedId, string>;
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
  tagNameMap: Record<number, string>;
  xpathMap: Record<number, string>;
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
  combinedXpathMap: Record<EncodedId, string>;
  combinedUrlMap: Record<EncodedId, string>;
}

export interface FrameSnapshot {
  frame: Frame;
  tree: string;
  xpathMap: Record<EncodedId, string>;
  urlMap: Record<EncodedId, string>;
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
