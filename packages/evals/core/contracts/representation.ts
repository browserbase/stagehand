export interface RepresentationOpts {
  includeIframes?: boolean;
}

export interface PageRepresentation {
  kind: "accessibility_tree" | "snapshot_refs" | "dom_text" | "custom";
  content: string;
  metadata?: {
    bytes?: number;
    tokenEstimate?: number;
    refCount?: number;
    nodeCount?: number;
  };
  raw?: unknown;
}
