/**
 * Options that control how hybrid snapshots and targeted scopes are captured.
 */
export type SnapshotOptions = {
  /**
   * Filter the snapshot to a specific element/subtree using a selector that can cross iframes.
   * Supports XPath (prefixed with `xpath=` or starting with `/`) and CSS with iframe hops via `>>`.
   */
  focusSelector?: string;
  /**
   * Pierce shadow DOM when calling DOM.getDocument. Defaults to true to retain the
   * existing behaviour.
   */
  pierceShadow?: boolean;
  /**
   * Toggle whether iframe subtrees are included in the merged snapshot. Defaults to true.
   */
  includeIframes?: boolean;
  /**
   * Optional feature flag that surfaces experimental traversal tweaks in the Accessibility layer.
   */
  experimental?: boolean;
};

/**
 * Hybrid snapshot payload consumed by act/extract/observe handlers.
 */
export type HybridSnapshot = {
  /** Merged outline across every frame. */
  combinedTree: string;
  /** EncodedId (frameOrdinal-backendNodeId) -> absolute XPath. */
  combinedXpathMap: Record<string, string>;
  /** EncodedId -> URL extracted from AX properties. */
  combinedUrlMap: Record<string, string>;
  /** Per-frame payloads expose the original relative data for debugging. */
  perFrame?: PerFrameSnapshot[];
};

export type PerFrameSnapshot = {
  frameId: string;
  outline: string;
  xpathMap: Record<string, string>;
  urlMap: Record<string, string>;
};

/**
 * Compact encoding of DOM data for an entire session. Shared between capture
 * and focus helpers so DOM traversal can be unit tested in isolation.
 */
export type SessionDomIndex = {
  rootBackend: number;
  absByBe: Map<number, string>;
  tagByBe: Map<number, string>;
  scrollByBe: Map<number, boolean>;
  docRootOf: Map<number, number>;
  contentDocRootByIframe: Map<number, number>;
};

export type FrameDomMaps = {
  tagNameMap: Record<string, string>;
  xpathMap: Record<string, string>;
  scrollableMap: Record<string, boolean>;
  urlMap: Record<string, string>;
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

export type Axis = "child" | "desc";

export type Step = {
  axis: Axis;
  raw: string;
  name: string;
};

export type A11yNode = {
  role: string;
  name?: string;
  description?: string;
  value?: string | number | boolean;
  nodeId: string;
  backendDOMNodeId?: number;
  parentId?: string;
  childIds?: string[];
  children?: A11yNode[];
  encodedId?: string;
};

export type A11yOptions = {
  focusSelector?: string;
  experimental: boolean;
  tagNameMap: Record<string, string>;
  scrollableMap: Record<string, boolean>;
  encode: (backendNodeId: number) => string;
};

export type AccessibilityTreeResult = {
  outline: string;
  urlMap: Record<string, string>;
  scopeApplied: boolean;
};

export type FrameParentIndex = Map<string, string | null>;

/**
 * Shared frame metadata that every snapshot step needs.
 * - `rootId`: stable identifier for the main frame so we can detect root prefixes.
 * - `parentByFrame`: lookup table for iframe parentage (used by focus scoping and prefixing).
 * - `frames`: DFS-ordered frame ids so merging walks parents before children.
 */
export type FrameContext = {
  rootId: string;
  parentByFrame: FrameParentIndex;
  frames: string[];
};
