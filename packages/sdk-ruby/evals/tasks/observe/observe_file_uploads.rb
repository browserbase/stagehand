# frozen_string_literal: true

# Port of packages/evals/tasks/bench/observe/observe_file_uploads.ts

Evals.define_task("observe_file_uploads") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/file-uploads-3/")

  observations = t.stagehand.observe("find the file upload element").data

  if observations.empty?
    next {
      _success: false,
      message: "observe returned no results",
      observations: observations.map(&:to_wire),
    }
  end

  expected_locator = "xpath=/html/body/input"

  # v3 compares backendNodeIds; the v4 Locator exposes no node identity
  # so the same element-identity check is
  # re-expressed in-page: resolve the observed selector and the expected
  # selector and compare element references.
  matched = t.page.evaluate(<<~JS)
    (() => {
      const observedSelector = #{observations[0].selector.to_json};
      const candidateSelectors = #{[expected_locator].to_json};
      const resolve = (selector) => {
        const raw = selector.startsWith("xpath=") ? selector.slice("xpath=".length) : selector;
        if (raw.startsWith("/") || raw.startsWith("(")) {
          const result = document.evaluate(raw, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          return result.singleNodeValue;
        }
        return document.querySelector(raw);
      };
      const observed = resolve(observedSelector);
      if (!observed) return null;
      for (const candidate of candidateSelectors) {
        if (resolve(candidate) === observed) return candidate;
      }
      return null;
    })()
  JS
  found_match = !matched.nil?

  { _success: found_match, observations: observations.map(&:to_wire) }
end
