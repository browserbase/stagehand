import type { FrameParentIndex } from "../../../types/private/snapshot.js";

export function listChildrenOf(parentByFrame: FrameParentIndex, parentId: string): string[] {
  const out: string[] = [];
  for (const [fid, p] of parentByFrame.entries()) {
    if (p === parentId) out.push(fid);
  }
  return out;
}
