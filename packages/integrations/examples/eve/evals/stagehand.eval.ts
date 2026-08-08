import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
  description: "Eve discovers and calls Stagehand through an authenticated remote MCP gateway.",
  async test(t) {
    await t.send(
      [
        "Use the Stagehand connection and call code_execute exactly once.",
        'Open example.com and store the exact marker string "persistent" on the page.',
        "Report the title and marker.",
      ].join(" "),
    );

    t.succeeded();
    t.calledTool("connection_search", { count: 1 });
    t.calledTool("stagehand__code_execute", {
      count: 1,
      output: (value) => {
        const output = JSON.stringify(value);
        return output.includes("Example Domain") && output.includes("persistent");
      },
    });
    t.check(t.reply, includes("Example Domain"));
    t.check(t.reply, includes("persistent"));
  },
});
