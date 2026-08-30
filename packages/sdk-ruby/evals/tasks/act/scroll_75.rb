# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/scroll_75.ts

Evals.define_task("scroll_75") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/")
  t.stagehand.act("Scroll 75% down the page")

  t.page.wait_for_timeout(5000)

  # Get the current scroll position and total scroll height
  scroll_info = t.page.evaluate(<<~JS)
    (() => {
      return {
        scrollTop: window.scrollY + window.innerHeight * 0.75,
        scrollHeight: document.documentElement.scrollHeight,
      };
    })()
  JS

  three_quarters_scroll = scroll_info["scrollHeight"] * 0.75
  three_quarters_reached = (scroll_info["scrollTop"] - three_quarters_scroll).abs <= 200

  if three_quarters_reached
    { _success: true }
  else
    {
      _success: false,
      message: "Scroll position (#{scroll_info["scrollTop"]}px) is not three quarters down the page (#{three_quarters_scroll}px).",
    }
  end
end
