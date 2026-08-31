# HardBenchmark validity audit — 2026-08-30

Source: `scripts/audit-hardbenchmark.ts`, full record in `audit-2026-08-30.json`. Live probes ran in Browserbase `verified` mode with a proxy retry on captcha/WAF; achievability cross-referenced two frontier-model trajectory sets from 2026-08-24 (aliased `model-1`/`model-2`).

**Result: 45 of 46 tasks valid.** 1 quarantined (`valid: false`, skipped by the suite builder), 20 flagged `verdict_review: stop-before-purchase` (still run; verdicts need a manual look), 3 worth a human glance.

## Quarantined (valid: false)

| task id                   | category            | check failed                             | evidence                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | ------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| heb_comparison_shopping_1 | constraint_handling | reachability — bot-wall (verified+proxy) | `heb.com/search?q=…` returns "www.heb.com Additional security check is required" (PerimeterX iframe) on verified mode AND on the proxy retry, twice, ~10 min apart. Amazon half of the task loads. One model did pass it on 2026-08-24, so the wall is intermittent — re-probe before the next campaign and un-quarantine if it clears. |

## Unsure — kept valid, please eyeball

| task id                          | category              | concern                                | evidence                                                                                                                                                                                                                                                                            |
| -------------------------------- | --------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| aa4b5cb7114fcc138ade82b4b9716d24 | looping               | deep page dead (HTTP 500)              | `ign.com/reviews/boardgame` and `/reviews/board-games` (the route both passing runs used) answer "IGN Error 500" consistently. `ign.com`, `/reviews`, `/editors-choice` load, so the editor's-choice boardgame review should still be findable; expect a harder task than on 08-24. |
| metmuseum_find_24                | looping               | ticket site refuses unproxied sessions | `engage.metmuseum.org/admission/` returns 403 "Transaction Denied — visit the Museum in person" in verified mode; loads fine with proxies (which the eval env always enables). Valid under the both-attempts rule, but an agent that hits the wall mid-checkout may loop.           |
| afcebfed28bea091d58f49ea6cb8194b | premature_termination | intermittent Akamai wall               | `cvs.com/search?searchTerm=…` was "Access Denied" for every `/shop/*` path in one 08-24 run and blocked once in this audit's first attempt; cleared with proxies. Neither model has passed it; failures were crashes/bot-wall, not missing content.                                 |

## Flagged for verdict review (verdict_review: stop-before-purchase)

Task wording says purchase/order/book/preorder; the rubric awards the final criterion for stopping at the checkout "critical point". The verifier's `outcomeSuccess` has been observed to demand the purchase anyway (see kelty_2 / petsmart_5650 / overstock_9388 history), so check these verdicts by hand.

| task id                     | category              | stop-at-checkout criterion                                                                             |
| --------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------ |
| amazon_7859                 | premature_termination | Progress the Amazon purchase flow up to (but not beyond) the critical point                            |
| colgate_1                   | looping               | Add both items to cart and stop before checkout (respect Critical Point boundaries)                    |
| eventbrite_tickets_book_76  | constraint_handling   | Select tickets (if applicable) and progress the booking flow up to (but not beyond) the Critical Point |
| fiestafactorydirect_1       | constraint_handling   | Stop before checkout / avoid entering sensitive details (critical point compliance)                    |
| housebeautiful_2            | premature_termination | Add the smoker to the cart (stop before checkout critical point)                                       |
| indytoday.6amcity_8         | constraint_handling   | Stop before the critical point (do not finalize booking or enter personal details)                     |
| metmuseum_find_24           | looping               | Proceed up to (but not beyond) the purchase Critical Point                                             |
| michaels_2250               | constraint_handling   | Stop before checkout critical point (no personal/payment details)                                      |
| nothingbundtcakes_6         | constraint_handling   | Progress the order up to (but not beyond) the checkout critical point                                  |
| oceanstatejoblot_4          | looping               | Stop before checkout / avoid Critical Point actions                                                    |
| overstock_8717              | premature_termination | Advance the ordering flow up to (but not beyond) the Critical Point                                    |
| recwatches_1                | premature_termination | Verify cart contains both requested items and stop before any binding checkout step                    |
| rockauto_1225               | constraint_handling   | Advance purchase workflow up to (but not beyond) the critical point                                    |
| rockauto_4460               | constraint_handling   | Progress purchase flow without crossing the Critical Point                                             |
| simpletire_5                | looping               | Stop before checkout critical point and avoid entering personal/payment information                    |
| tagwoodbbq_1                | constraint_handling   | Add both items to cart and stop before checkout critical point                                         |
| tiqets_tickets_book_5       | constraint_handling   | Advance purchase flow up to (but not beyond) the Critical Point                                        |
| tripadvisor_plan_a_trip_118 | premature_termination | Prepare Teatro Colón tour purchase up to (but not beyond) the critical point                           |
| underarmour_7483            | constraint_handling   | Advance purchase flow up to (but not beyond) the Critical Point                                        |
| walgreens_10                | premature_termination | Advance purchase flow up to (but not beyond) the Critical Point                                        |

## Reachability notes (all valid)

Blocked without proxy, fine with proxy (eval env runs `proxies: true`): `tripadvisor_plan_a_trip_118`, `tripadvisor_question_answering_185` (DataDome 403), `wayfair_comparison_shopping_3` (PerimeterX press-and-hold, 429), `metmuseum_find_24`, `afcebfed28bea091d58f49ea6cb8194b`. Everything else answered 200 with real content on the start URL and the deep page(s) the task needs.

## Achievability (check 3)

Never passed by either model (kept valid — content is present; failures are crashes on the `awaitActivePage` session bug, bot-walls, or genuine model errors): `7e1047f4803237f319c004f7a7f6bccb` (Best Buy trade-in), `a0a18ca6a3529f3e97c771aadd42d3a0` (Macy's filters), `afcebfed28bea091d58f49ea6cb8194b` (CVS), `apply_apply_2317` (Thermo Fisher), `homedepot_comparison_shopping_18` (Home Depot "Oops" wall in past runs; loads today), `nothingbundtcakes_6`, `overstock_8717` (Overstock Access Denied in past runs; loads today), `rockauto_1225`, `rockauto_4460`. No task showed delisted products, 404s, or date-rotted bookings.

## Rubric shape (check 2)

All 46 rubrics well-formed: non-empty `items`, every item has string `criterion` + `description` and positive `maxPoints`, no duplicate criteria.
