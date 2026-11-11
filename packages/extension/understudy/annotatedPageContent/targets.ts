import type { Page } from "../page.js";
import type { Progress } from "../progress.js";
import type { Frame } from "../frame.js";
import type { ChainTarget } from "../locatorChain.js";
import { resolveContentFrame } from "../frameLocator.js";
import type { AnnotatedPageContent } from "./index.js";
import type { ContentNodeJson } from "./common_quality_data_pb.js";
import { isRedacted } from "./actions.js";

export type ApcTarget = ChainTarget & { id: string };

/** Bind APC DOM identities to the owning CDP frame, using the snapshot ID convention. */
export async function resolveAnnotatedPageContentTargets(
  page: Page,
  content: AnnotatedPageContent,
  progress: Progress,
): Promise<Map<ContentNodeJson, ApcTarget>> {
  const targets = new Map<ContentNodeJson, ApcTarget>();
  if (!content.rootNode) return targets;
  const pending: Array<{ source: ContentNodeJson; frame?: Frame }> = [
    { source: content.rootNode, frame: page.mainFrame() },
  ];
  while (pending.length) {
    progress.throwIfStopped();
    const { source, frame } = pending.pop()!;
    const attributes = source.contentAttributes;
    const backendNodeId = attributes?.commonAncestorDomNodeId;
    const hasNode = backendNodeId !== undefined && backendNodeId > 0;
    if (frame && hasNode) {
      targets.set(source, {
        id: String(page.getOrdinal(frame.frameId)) + "-" + backendNodeId,
        frame,
        backendNodeId,
      });
    }
    if (isRedacted(attributes) || attributes?.iframeData?.redactedFrameMetadata) continue;
    let childFrame = frame;
    if (attributes?.iframeData || attributes?.attributeType === "CONTENT_ATTRIBUTE_IFRAME") {
      // Never attribute unresolved child-frame nodes to their parent's document.
      childFrame =
        frame && hasNode && source.childrenNodes?.length
          ? await resolveContentFrame(page, frame, backendNodeId, progress)
          : undefined;
    }
    for (const child of source.childrenNodes ?? [])
      pending.push({ source: child, frame: childFrame });
  }
  return targets;
}
