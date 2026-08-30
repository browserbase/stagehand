# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/heal_custom_dropdown.ts

Evals.define_task("heal_custom_dropdown") do |t|
  # This eval is meant to test whether we do not incorrectly attempt
  # the selectOptionFromDropdown method (defined in actHandlerUtils.ts) on a
  # 'dropdown' that is not a <select> element.
  #
  # This kind of dropdown must be clicked to be expanded before being interacted
  # with.

  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/expand-dropdown/")

  # Self-healing act(Action) replay (restored by
  # stagehand#2427): same intentionally invalid selector as the v3
  # twin — healing must re-locate "The 'Select a country' dropdown"
  # and click it to expand.
  healed = t.stagehand.act(Stagehand::Models::Action.new(
    description: "The 'Select a country' dropdown",
    selector: "/html/not-a-dropdown",
    arguments: [],
    method: "click",
  )).data

  # Report a failed heal directly rather than letting it surface as an
  # absent dropdown option. Healing requires selfHeal: true at init; the
  # server defaults it off and it cannot be set per-call.
  unless healed.success
    next { _success: false, message: "self-heal did not expand the dropdown: #{healed.message}" }
  end

  # If the dropdown expanded, its options are now rendered in the DOM.
  # (v3 checked the schemaless-extract page text; v4 extract requires a
  # schema, so read the rendered text directly — same signal, no LLM.)
  page_text = t.page.evaluate("(() => document.body.innerText)()")

  if page_text.include?("Canada")
    next { _success: true }
  end

  { _success: false, message: "unable to expand the dropdown" }
end
