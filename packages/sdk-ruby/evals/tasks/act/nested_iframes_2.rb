# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/nested_iframes_2.ts

Evals.define_task("nested_iframes_2") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/nested-iframes-2/")

  t.stagehand.act("click the button called 'click me (inner 2)'")

  # v3 chained frameLocator iframe2.html -> inner2.html; v4 has no
  # frameLocator, so the same check is re-expressed in-page by walking
  # the same-origin iframes' contentDocuments.
  message_text = t.page.evaluate(<<~JS)
    (() => {
      const outer = document.querySelector('iframe[src="iframe2.html"]')?.contentDocument;
      const inner = outer?.querySelector('iframe[src="inner2.html"]')?.contentDocument;

      const msg = inner?.querySelector("#msg");
      if (!msg) {
        throw new Error("could not resolve #msg in the nested iframes");
      }
      return msg.textContent ?? "";
    })()
  JS

  passed = message_text.downcase.strip == "clicked the button in the second inner iframe"

  { _success: passed }
end
