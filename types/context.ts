import type { BrowserContext as PlaywrightContext } from "@playwright/test";
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
};

export type BackendIdMaps = {
  tagNameMap: Record<number, string>;
  xpathMap: Record<number, string>;
};

export interface EnhancedContext
  extends Omit<PlaywrightContext, "newPage" | "pages"> {
  newPage(): Promise<Page>;
  pages(): Page[];
}
