# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/next_chunk.ts

Evals.define_task("next_chunk") do |t|
  t.page.goto("https://www.apartments.com/san-francisco-ca/", wait_until: "domcontentloaded")
  t.stagehand.act("click on the all filters button")

  measurements = t.page.evaluate(<<~JS)
    (() => {
      const container = document.querySelector("#advancedFilters > div");
      if (!container) {
        console.warn("Could not find #advancedFilters > div. Returning 0 for measurements.");
        return { initialScrollTop: 0, chunkHeight: 0 };
      }
      return {
        initialScrollTop: container.scrollTop,
        chunkHeight: container.getBoundingClientRect().height,
      };
    })()
  JS
  initial_scroll_top = measurements["initialScrollTop"]
  chunk_height = measurements["chunkHeight"]

  t.stagehand.act("scroll down one chunk on the filters modal")

  t.page.wait_for_timeout(2000)

  new_scroll_top = t.page.evaluate(<<~JS)
    (() => {
      const container = document.querySelector("#advancedFilters > div");
      return container?.scrollTop ?? 0;
    })()
  JS

  actual_diff = new_scroll_top - initial_scroll_top
  threshold = 20 # allowable difference in px
  scrolled_one_chunk = (actual_diff - chunk_height).abs <= threshold

  if scrolled_one_chunk
    { _success: true,
      message: "Successfully scrolled ~one chunk: expected ~#{chunk_height}, got #{actual_diff}" }
  else
    { _success: false,
      message: "Scroll difference expected ~#{chunk_height} but only scrolled #{actual_diff}." }
  end
end
