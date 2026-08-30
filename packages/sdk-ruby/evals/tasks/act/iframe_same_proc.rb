# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/iframe_same_proc.ts

Evals.define_task("iframe_same_proc") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/iframe-same-proc/")

  t.stagehand.act("type 'stagehand' into the 'your name' field")

  # overly specific prompting is okay here. we are just trying to evaluate whether
  # we are properly traversing iframes
  t.stagehand.act(
    "select 'Green' from the favorite colour dropdown. Ensure the word 'Green' is capitalized. Choose the selectOption method.",
  )

  # v3 used page.frameLocator("iframe") for these assertions; v4 has no
  # frameLocator, so the same checks are re-expressed in-page via the
  # same-origin iframe's contentDocument.
  values = t.page.evaluate(<<~JS)
    (() => {
      const doc = document.querySelector("iframe")?.contentDocument;
      if (!doc) throw new Error("could not access iframe contentDocument");

      const name = doc.querySelector('input[placeholder="Alice"]');
      const color = doc.querySelector("select");

      if (!name || !color) {
        throw new Error("could not resolve form fields inside the iframe");
      }

      return {
        nameValue: name.value,
        colorValue: color.value,
      };
    })()
  JS
  name_value = values["nameValue"]
  color_value = values["colorValue"]

  passed =
    name_value.downcase.strip == "stagehand" &&
    color_value.downcase.strip == "green"

  { _success: passed }
end
