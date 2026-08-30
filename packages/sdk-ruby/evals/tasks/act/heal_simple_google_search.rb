# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/heal_simple_google_search.ts

Evals.define_task("heal_simple_google_search") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/google/")

  # Self-healing act(Action) replay (restored by
  # stagehand#2427): same intentionally invalid selector as the v3
  # twin — healing must re-locate "The search bar" and fill it.
  healed = t.stagehand.act(Stagehand::Models::Action.new(
    description: "The search bar",
    selector: "/html/not-the-search-bar",
    arguments: ["OpenAI"],
    method: "fill",
  )).data

  # Without this the task presses Enter on an empty field and reports a
  # URL mismatch, hiding why healing did not happen. Note that healing
  # only runs when the client was initialized with selfHeal: true — the
  # server defaults it to false (actService.ts), and it cannot be set
  # per-call, so a failure here usually means an init-level difference.
  unless healed.success
    next { _success: false, message: "self-heal did not fill the search bar: #{healed.message}" }
  end

  t.stagehand.act("press enter")
  t.page.wait_for_timeout(3000)

  expected_url = "https://browserbase.github.io/stagehand-eval-sites/sites/google/openai.html"
  current_url = t.page.url

  { _success: current_url.start_with?(expected_url), currentUrl: current_url }
end
