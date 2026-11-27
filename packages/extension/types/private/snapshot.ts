import type { Locator, LocatorInput } from "@browserbasehq/stagehand-protocol/types";

export type SnapshotOptions = {
  focusLocator?: LocatorInput;
  ignoreLocators?: LocatorInput[];
  pierceShadow?: boolean;
  includeIframes?: boolean;
};

export type HybridSnapshot = {
  combinedTree: string;
  combinedXpathMap: Record<string, string>;
  combinedUrlMap: Record<string, string>;
  combinedEditableIds?: string[];
  perFrame?: PerFrameSnapshot[];
};

export type PerFrameSnapshot = {
  frameId: string;
  outline: string;
  xpathMap: Record<string, string>;
  urlMap: Record<string, string>;
  editableIds?: string[];
};

export type SessionDomIndex = {
  rootBackend: number;
  absByBe: Map<number, string>;
  tagByBe: Map<number, string>;
  scrollByBe: Map<number, boolean>;
  docRootOf: Map<number, number>;
  contentDocRootByIframe: Map<number, number>;
  enterByBe: Map<number, number>;
  exitByBe: Map<number, number>;
};

export type FrameDomMaps = {
  tagNameMap: Record<string, string>;
  xpathMap: Record<string, string>;
  scrollableMap: Record<string, boolean>;
  urlMap: Record<string, string>;
  editableIds?: string[];
};

export type ResolvedLocation = {
  frameId: string;
  backendNodeId: number;
  absoluteXPath: string;
};

export type ResolvedFocusFrame = {
  targetFrameId: string;
  tailXPath: string;
  absPrefix: string;
};

export type ResolvedCssFocus = {
  targetFrameId: string;
  tailSelector: string;
  absPrefix: string;
};

export type {
  LegacyXPathAxis as Axis,
  LegacyXPathStep as Step,
} from "../../understudy/selectorQuery.js";

export type A11yNode = {
  role: string;
  name?: string;
  description?: string;
  value?: string | number | boolean;
  selected?: boolean;
  checked?: boolean;
  nodeId: string;
  backendDOMNodeId?: number;
  parentId?: string;
  childIds?: string[];
  children?: A11yNode[];
  encodedId?: string;
};

export type A11yOptions = {
  focusBackendNodeId?: number;
  focusLocator?: Locator;
  isIgnoredBackendNode?: (backendNodeId: number) => boolean;
  tagNameMap: Record<string, string>;
  scrollableMap: Record<string, boolean>;
  encode: (backendNodeId: number) => string;
};

export type AccessibilityTreeResult = {
  outline: string;
  urlMap: Record<string, string>;
  editableIds?: string[];
  scopeApplied: boolean;
};

export type FrameParentIndex = Map<string, string | null>;

export type FrameContext = {
  rootId: string;
  parentByFrame: FrameParentIndex;
  frames: string[];
};
