# frozen_string_literal: true

# Port of packages/evals/tasks/bench/observe/observe_vantechjournal.ts

Evals.define_task("observe_vantechjournal") do |t|
  t.page.goto("https://vantechjournal.com/archive")

  observations = t.stagehand.observe("Find the 'load more' link").data

  if observations.empty?
    next { _success: false, observations: observations.map(&:to_wire) }
  end

  expected_locators = [
    "xpath=/html/body/div[2]/div/div/section/div/div/div[3]/a",
    "xpath=/html/body/div[2]/div/div/section/div/div/div[3]/a/span",
  ]

  # v3 compares backendNodeIds (first observation vs. each expected
  # locator); the v4 Locator exposes no node identity
  # so the same element-identity check is
  # re-expressed in-page: resolve the observed selector and each
  # expected selector and compare element references. Expected locators
  # that fail to resolve are skipped, as in v3.
  matched = t.page.evaluate(<<~JS)
    (() => {
      const observedSelector = #{observations[0].selector.to_json};
      const candidateSelectors = #{expected_locators.to_json};
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

  {
    _success: found_match,
    expected: expected_locators,
    observations: observations.map(&:to_wire),
  }
end
