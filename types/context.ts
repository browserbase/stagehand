import type { BrowserContext as PuppeteerContext } from "puppeteer-core";
import { Page } from "../types/page";
import { CDPSession } from "puppeteer-core";

export interface AXNode {
  role?: { value: string };
  name?: { value: string };
  description?: { value: string };
  value?: { value: string };
  nodeId: string;
  backendDOMNodeId?: number;
  parentId?: string;
  childIds?: string[];
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
};

export interface TreeResult {
  tree: AccessibilityNode[];
  simplified: string;
  iframes?: AccessibilityNode[];
}

export interface EnhancedContext
  extends Omit<PuppeteerContext, "newPage" | "pages"> {
  newPage(): Promise<Page>;
  pages(): Page[];
  newCDPSession(page: Page): Promise<CDPSession>;
}
