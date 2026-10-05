---
"@browserbasehq/stagehand": patch
---

Honor `browserSettings.solveCaptchas` and `waitForCaptchaSolves` when attaching to Browserbase through `env: "LOCAL"`, and forward CAPTCHA awareness to the hosted API. Agents can wait for solve events and receive solved notices without changing CDP routing or session ownership. Explicit `false` for either option disables CAPTCHA awareness.
