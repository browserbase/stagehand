# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/iframes_nested.ts

Evals.define_task("iframes_nested") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/nested-iframes/")

  t.stagehand.act("type 'stagehand' into the 'username' field")

  # v3 chained frameLocator lvl1 -> lvl2 -> lvl3 (form lives in level 3);
  # v4 has no frameLocator, so the same check is re-expressed in-page by
  # walking the same-origin iframes' contentDocuments.
  username_text = t.page.evaluate(<<~JS)
    (() => {
      const lvl1 = document.querySelector("iframe.lvl1")?.contentDocument; // level 1
      const lvl2 = lvl1?.querySelector("iframe.lvl2")?.contentDocument; // level 2
      const lvl3 = lvl2?.querySelector("iframe.lvl3")?.contentDocument; // level 3 – form lives here

      const input = lvl3?.querySelector('input[name="username"]');
      if (!input) {
        throw new Error("could not resolve the username input in the nested iframes");
      }
      return input.value;
    })()
  JS

  passed = username_text.downcase.strip == "stagehand"

  { _success: passed }
end
