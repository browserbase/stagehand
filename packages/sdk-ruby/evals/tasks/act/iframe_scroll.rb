# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/iframe_scroll.ts

Evals.define_task("iframe_scroll") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/iframe-same-proc-scroll/")
  t.stagehand.act("scroll down 50% inside the iframe")

  t.page.wait_for_timeout(5000)

  # v3 evaluated inside page.frames()[1]; v4 exposes no frames() list,
  # so the same measurement is re-expressed via the same-origin iframe's
  # contentWindow/contentDocument.
  scroll_info = t.page.evaluate(<<~JS)
    (() => {
      const iframe = document.querySelector("iframe");
      const win = iframe?.contentWindow;
      const doc = iframe?.contentDocument;
      if (!win || !doc) {
        throw new Error("could not access iframe content");
      }
      return {
        scrollTop: win.scrollY + win.innerHeight / 2,
        scrollHeight: doc.documentElement.scrollHeight,
      };
    })()
  JS

  scroll_top = scroll_info["scrollTop"]
  halfway_scroll = scroll_info["scrollHeight"] / 2.0
  halfway_reached = (scroll_top - halfway_scroll).abs <= 1

  if halfway_reached
    { _success: true }
  else
    {
      _success: false,
      message: "Scroll position (#{scroll_top}px) is not halfway down the page (#{halfway_scroll}px).",
    }
  end
end
