import { fromBinary, toJson } from "@bufbuild/protobuf";
import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "../cdp.js";
import type { Progress } from "../progress.js";
import {
  AnnotatedPageContentSchema,
  type AnnotatedPageContentJson,
} from "./common_quality_data_pb.js";

export type AnnotatedPageContent = AnnotatedPageContentJson;

/** Preserve explicit defaults, absent fields, enum names, and int64 precision. */
export function decodeAnnotatedPageContent(content: string): AnnotatedPageContent {
  const bytes = Uint8Array.from(atob(content), (character) => character.charCodeAt(0));
  return toJson(AnnotatedPageContentSchema, fromBinary(AnnotatedPageContentSchema, bytes));
}

/** Internal capture; callers own the budget shared with filtering and formatting. */
export async function captureAnnotatedPageContent(
  session: CDPSessionLike,
  progress: Progress,
): Promise<AnnotatedPageContent> {
  const { content } = await progress.run("capturing annotated page content", () =>
    session.send<Protocol.Page.GetAnnotatedPageContentResponse>("Page.getAnnotatedPageContent", {
      includeActionableInformation: true,
    } satisfies Protocol.Page.GetAnnotatedPageContentRequest),
  );
  progress.throwIfStopped();
  const decoded = decodeAnnotatedPageContent(content);
  progress.throwIfStopped();
  return decoded;
}
