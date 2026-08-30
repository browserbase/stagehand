# frozen_string_literal: true

# Port of packages/evals/tasks/bench/observe/observe_github.ts

Evals.define_task("observe_github") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/github/")

  observations = t.stagehand.observe("find the scrollable element that holds the repos file tree.").data

  if observations.empty?
    next { _success: false, observations: observations.map(&:to_wire) }
  end

  possible_locators = [
    "#repo-content-pjax-container > react-app > div > div > div.prc-PageLayout-PageLayoutRoot-1zlEO > div > div > div.Box-sc-g0xbh4-0.gISSDQ",
    "#repo-content-pjax-container > react-app > div > div > div.prc-PageLayout-PageLayoutRoot-1zlEO > div > div > div.Box-sc-g0xbh4-0.gISSDQ > div",
    "#repo-content-pjax-container > react-app > div > div > div.prc-PageLayout-PageLayoutRoot-1zlEO > div > div > div.Box-sc-g0xbh4-0.gISSDQ > div > div.prc-PageLayout-Pane-Vl5LI",
    "#repo-content-pjax-container > react-app > div > div > div.prc-PageLayout-PageLayoutRoot-1zlEO > div > div > div.Box-sc-g0xbh4-0.gISSDQ > div > div.prc-PageLayout-Pane-Vl5LI > div",
    "#repos-file-tree > div.Box-sc-g0xbh4-0.ReposFileTreePane-module__Box_5--tQNH_",
    "#repos-file-tree > div.Box-sc-g0xbh4-0.ReposFileTreePane-module__Box_5--tQNH_ > div",
    "#repos-file-tree > div.Box-sc-g0xbh4-0.ReposFileTreePane-module__Box_5--tQNH_ > div > div",
    "#repos-file-tree > div.Box-sc-g0xbh4-0.ReposFileTreePane-module__Box_5--tQNH_ > div > div > div > nav",
    "#repos-file-tree > div.Box-sc-g0xbh4-0.ReposFileTreePane-module__Box_5--tQNH_ > div > div > div > nav > ul",
  ]

  # v3 compares backendNodeIds; the v4 Locator exposes no node identity
  # so the same element-identity check is
  # re-expressed in-page: resolve the observed selector and each
  # candidate selector and compare element references. Candidates that
  # fail to resolve are ignored, as in v3.
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
