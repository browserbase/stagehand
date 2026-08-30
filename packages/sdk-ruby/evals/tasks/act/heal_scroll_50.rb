# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/heal_scroll_50.ts

Evals.define_task("heal_scroll_50") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/")

  # Self-healing act(Action) replay (restored by
  # stagehand#2427): same supplied action as the v3 twin — a
  # "scrollTo" with arguments ["50%"], exercising the deterministic
  # executor with variable substitution and healing.
  healed = t.stagehand.act(Stagehand::Models::Action.new(
    description: "the element to scroll on",
    selector: "/html/body/div/div/button",
    arguments: ["50%"],
    method: "scrollTo",
  )).data

  # Report a failed heal directly rather than letting it surface as an
  # unchanged scroll position. Healing requires selfHeal: true at init;
  # the server defaults it off and it cannot be set per-call.
  unless healed.success
    next { _success: false, message: "self-heal did not scroll the page: #{healed.message}" }
  end

  t.page.wait_for_timeout(5000)

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

  result = { _success: halfway_reached }
  unless halfway_reached
    result[:message] =
      "Scroll position (#{scroll_info["scrollTop"]}px) is not halfway down the page (#{halfway_scroll}px)."
  end
  result
end
