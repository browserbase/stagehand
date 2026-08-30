# frozen_string_literal: true

# Port of packages/evals/tasks/bench/observe/observe_yc_startup.ts

Evals.define_task("observe_yc_startup") do |t|
  t.page.goto("https://www.ycombinator.com/companies", wait_until: "networkidle")

  observations = t.stagehand.observe(
    "Click the container element that holds links to each of the startup companies. " \
    "The companies each have a name, a description, and a link to their website.",
  ).data

  if observations.empty?
    next { _success: false, observations: observations.map(&:to_wire) }
  end

  possible_locators = [
    "div._rightCol_18olp_594",
    "div._section_18olp_165._results_18olp_345",
  ]

  # v3 compares backendNodeIds; the v4 Locator exposes no node identity
  # so the same element-identity check is
  # re-expressed in-page: resolve the observed selector and each
  # candidate selector and compare element references.
  matching_selector = lambda do |observed_selector, candidate_selectors|
    t.page.evaluate(<<~JS)
      (() => {
        const observedSelector = #{observed_selector.to_json};
        const candidateSelectors = #{candidate_selectors.to_json};
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
  end

  found_match = false
  matched_locator = nil

  observations.each do |observation|
    matched = matching_selector.call(observation.selector, possible_locators)
    if matched
      found_match = true
      matched_locator = matched
      break
    end
  rescue StandardError => e
    t.logger.log("Failed to check observation with selector #{observation.selector}: #{e.message}")
    next
  end

  {
    _success: found_match,
    matchedLocator: matched_locator,
    observations: observations.map(&:to_wire),
  }
end
