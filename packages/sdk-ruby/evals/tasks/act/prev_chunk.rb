# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/prev_chunk.ts

Evals.define_task("prev_chunk") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/")
  t.page.wait_for_timeout(2000)
  measurements = t.page.evaluate(<<~JS)
    (() => {
      const halfPage = document.body.scrollHeight / 2;

      window.scrollTo({
        top: halfPage,
        left: 0,
        behavior: "instant",
      });

      const chunk = window.innerHeight;

      return {
        initialScrollTop: window.scrollY,
        chunkHeight: chunk,
      };
    })()
  JS
  initial_scroll_top = measurements["initialScrollTop"]
  chunk_height = measurements["chunkHeight"]

  t.page.wait_for_timeout(2000)
  t.stagehand.act("scroll up one chunk")

  t.page.wait_for_timeout(5000)

  final_scroll_top = t.page.evaluate("(() => window.scrollY)()")

  actual_diff = initial_scroll_top - final_scroll_top
  threshold = 20 # px tolerance
  scrolled_one_chunk = (actual_diff - chunk_height).abs <= threshold

  if scrolled_one_chunk
    { _success: true,
      message: "Successfully scrolled ~one chunk UP: expected ~#{chunk_height}, got #{actual_diff}." }
  else
    { _success: false,
      message: "Scroll difference expected ~#{chunk_height} but only scrolled #{actual_diff}." }
  end
end
