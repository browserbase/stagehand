import type { StagehandExtractParams } from "@browserbasehq/stagehand-protocol/types";
import type { Progress } from "../../understudy/progress.js";
import type { JsonSchema } from "./extractionSchema.js";
import { readHeadingText, type HeadingRequest } from "./headingProjection.js";
import { readAnchorDestinations, requestedDestination } from "./linkDestination.js";
import { readTableEvidence, type TableScope } from "./tableEvidence.js";
import { tableRequest } from "./tableProjection.js";

export type DocumentExtraction = NonNullable<ReturnType<typeof prepareDocumentExtraction>>;

export function prepareDocumentExtraction(
  { instruction, options, schema }: StagehandExtractParams,
  evaluate: ((expression: string) => Promise<unknown>) | undefined,
  progress: Progress,
  hasFallbackModel: boolean,
) {
  if (
    !instruction ||
    !evaluate ||
    options?.screenshot ||
    options?.locator ||
    options?.ignoreLocators?.length
  )
    return;
  // Page readers are self-contained functions serialized into the browser's execution context.
  const read = <Arg, Result>(step: string, reader: (arg: Arg) => Result, arg: Arg) =>
    progress.run(
      step,
      async () => (await evaluate(`(${reader.toString()})(${JSON.stringify(arg)})`)) as Result,
    );
  return {
    destination: requestedDestination(instruction, schema as JsonSchema),
    table: hasFallbackModel ? tableRequest(instruction, schema as JsonSchema) : undefined,
    readTable: (scope: TableScope) => read("reading table text", readTableEvidence, scope),
    readLinks: (pattern: string) =>
      read("reading anchor destinations", readAnchorDestinations, pattern),
    readHeadings: ({ level, sections }: HeadingRequest) =>
      read("reading heading text", readHeadingText, { level, sections }),
  };
}
