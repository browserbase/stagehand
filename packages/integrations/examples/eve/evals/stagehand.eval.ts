import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
  description: "Eve discovers and calls Stagehand through an authenticated remote MCP gateway.",
  async test(t) {
    await t.send(
      [
        "Use connection_search to discover the Stagehand connection.",
        "Then call stagehand__code_execute exactly twice, in order.",
        'First open https://example.com and store "eve-direct-persistent" in',
        "document.documentElement.dataset.eveStagehandDirectMarker.",
        "Return the pageId, title, marker, process.env.OPENAI_API_KEY, and",
        "process.env.EVE_HOST_ONLY_MARKER from that first call.",
        "In the second call, read and verify that same direct marker without navigating.",
        'Then store "eve-model-persistent" in',
        "document.documentElement.dataset.eveStagehandModelMarker and return both markers,",
        "the current pageId and title, and the same two environment lookups.",
        "Report the title and both exact markers after the two calls.",
      ].join(" "),
    );

    t.succeeded();
    t.calledTool("connection_search", { count: 1 });
    t.calledTool("stagehand__code_execute", {
      count: 2,
      output: (value) => {
        const output = JSON.stringify(value);
        return (
          output.includes("Example Domain") &&
          output.includes("eve-direct-persistent") &&
          output.includes('"modelKeyVisible":null') &&
          output.includes('"hostMarkerVisible":null')
        );
      },
    });
    t.check(t.reply, includes("Example Domain"));
    t.check(t.reply, includes("eve-direct-persistent"));
    t.check(t.reply, includes("eve-model-persistent"));
  },
});
