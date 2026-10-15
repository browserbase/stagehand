import type { Protocol } from "devtools-protocol";

/** Snapshot fallback may ignore a transient lookup failure, but not an invalid query. */
export class SelectorEvaluationError extends Error {
  constructor(details: Protocol.Runtime.ExceptionDetails) {
    super(details.exception?.description ?? details.text, { cause: details });
    this.name = "SelectorEvaluationError";
  }
}
