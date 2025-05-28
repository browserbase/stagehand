import type {
  BrowserContext as PlaywrightContext,
  Frame,
} from "@playwright/test";
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
  idToUrl: Record<string, string>;
  xpathMap: Record<number, string>;
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
  tree: string;
  xpathMap: Record<EncodedId, string>;
  urlMap: Record<EncodedId, string>;
  frameXpath: string;
  backendNodeId: number | null;
  parentFrame?: Frame;
}

export type EncodedId = `${number}-${number}`;

export const frameToOrdinal = new Map<Frame | undefined, number>();
export const ordinalToFrame = new Map<number, Frame | undefined>();

/** Return the stable ordinal for a frame (0-based, ≤ 99). */
export function getFrameOrdinal(frame: Frame | undefined): number {
  // already registered?
  const cached = frameToOrdinal.get(frame);
  if (cached !== undefined) return cached;

  // assign next ordinal
  const ord = frameToOrdinal.size; // 0 for main frame
  if (ord > 99) throw new Error("More than 100 frames – enlarge format");

  frameToOrdinal.set(frame, ord);
  ordinalToFrame.set(ord, frame);
  return ord;
}

export const encodeId = (
  backendId: number,
  frame: Frame | undefined,
): EncodedId => `${getFrameOrdinal(frame)}-${backendId}`;

export const decodeId = (id: EncodedId) => {
  const [ord, backend] = id.split("-");
  return { frameOrdinal: +ord, backendId: +backend };
};
