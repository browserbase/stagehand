import {
  createBraintrustTraceReporter,
  type EventBusTraceSpan,
  hasBraintrustApiKey,
  loadBraintrust,
  logBraintrustTraceSpans,
  type BraintrustTraceReporter,
  type BraintrustTraceToolDefinition,
} from "./braintrust.js";

export class StagehandV4BraintrustReporter {
  private readonly reporter: BraintrustTraceReporter;
  private count = 0;

  constructor(toolCatalog: BraintrustTraceToolDefinition[]) {
    this.reporter = createBraintrustTraceReporter(toolCatalog);
  }

  get enabled(): boolean {
    return hasBraintrustApiKey();
  }

  get loggedCount(): number {
    return this.count;
  }

  async attachCurrentSpan(): Promise<void> {
    if (!this.enabled) return;
    const { currentSpan, NOOP_SPAN } = await loadBraintrust();
    const parent = currentSpan();
    if (parent !== NOOP_SPAN) this.reporter.parent = parent;
  }

  async handle(record: EventBusTraceSpan): Promise<number> {
    if (!this.enabled) return 0;
    const logged = await logBraintrustTraceSpans([record], this.reporter);
    this.count += logged;
    return logged;
  }
}
