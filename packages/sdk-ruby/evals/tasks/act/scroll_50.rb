# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/scroll_50.ts

Evals.define_task("scroll_50") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/")
  t.stagehand.act("Scroll 50% down the page")

  t.page.wait_for_timeout(5000)

  # Get the current scroll position and total scroll height
  scroll_info = t.page.evaluate(<<~JS)
    (() => {
      return {
        scrollTop: window.scrollY + window.innerHeight / 2,
        scrollHeight: document.documentElement.scrollHeight,
      };
    })()
  JS

  halfway_scroll = scroll_info["scrollHeight"] / 2.0
  halfway_reached = (scroll_info["scrollTop"] - halfway_scroll).abs <= 200

  if halfway_reached
    { _success: true }
  else
    {
      _success: false,
      message: "Scroll position (#{scroll_info["scrollTop"]}px) is not halfway down the page (#{halfway_scroll}px).",
    }
  end
end
