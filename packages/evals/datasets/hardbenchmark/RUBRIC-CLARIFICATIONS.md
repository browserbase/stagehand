# Rubric v1.2 clarification policy

The precomputed rubric is the scoring input. The task question, IDs, validity
and cohort membership did not change. The following conventions were appended
to relevant criteria in 149 of 158 rows; `clarifications` records the rules on
each changed row. The other nine rows are unchanged. The transform is in
`scripts/audit/rubric-clarify.py` relative to the eval package.

1. **Table format.** Consistent delimited records satisfy a table requirement:
   Markdown, HTML, pipe/semicolon/comma records, including a single line.
   Every required field and row must still be present. Unstructured prose fails.
2. **Permitted fallback versus site blocker.** If the requested item/service is
   unavailable, a disclosed fallback explicitly permitted by that criterion can
   satisfy it. This waives only the named requirement; all other constraints
   still apply. A CAPTCHA, bot wall, login wall, site error or crash is a site
   blocker. Honest reporting can earn process credit, but does not establish a
   completed outcome. Environment-failure attribution does not recover a pass.
3. **Critical point.** Reaching cart, checkout or booking with all personal and
   payment fields untouched and no submission is before the critical point.
   Entering personal/payment information or submitting crosses it. Any narrower
   explicit prohibition in the task remains relevant.
4. **Source authority.** A retailer/carrier/venue value must come from that
   entity's own page when the trajectory visited it. A competitor's comparison
   table does not override that source's own price or terms.
5. **Relative dates.** Resolve relative dates against the date visible in the
   browser during the run. A one-day difference from the run's UTC timestamp
   does not by itself establish an error.
6. **Park deliverable.** Task `47e314cc452c540524ffb7cf520285a3` asks for the park
   with the cheapest paddling permit. Naming the correct park satisfies its
   outcome even if the final answer omits prices; finding permit costs remains
   supporting evidence for process credit.

These conventions are prose delivered to main's existing V3 rubric verifier.
There is no deterministic format/fallback classifier or automatic score overlay.
Compatibility tests establish transport, rubric preservation and scoring shape;
only a separately executed live fixture gate assesses the bounded interpretation
of these rules. Neither check establishes overall evaluator accuracy.
