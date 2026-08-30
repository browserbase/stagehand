# frozen_string_literal: true

# Port of packages/evals/tasks/bench/observe/observe_iframes2.ts

Evals.define_task("observe_iframes2") do |t|
  t.page.goto("https://iframetester.com/?url=https://shopify.com")
  t.page.wait_for_timeout(5000)

  observations = nil
  begin
    observations = t.stagehand.observe("find the main header of the page").data
  rescue StandardError => e
    next { _success: false, message: e.message }
  end

  if observations.empty?
    next { _success: false, observations: observations.map(&:to_wire) }
  end

  possible_locators = [
    "#iframe-window",
    "body > header > h1",
  ]

  # v3 compares backendNodeIds; the v4 Locator exposes no node identity
  # so the same element-identity check is
  # re-expressed in-page. Both candidate selectors live in the main
  # frame (the shopify iframe is cross-origin and unreachable from the
  # main document either way): an observed selector that pierces into
  # the iframe never had a backendNodeId equal to either main-frame
  # candidate in v3 (no match), and here it simply fails to resolve in
  # the main document (no match) — the pass criterion is preserved.
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
