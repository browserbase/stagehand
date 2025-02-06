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
}
