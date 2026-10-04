# Evaluator migration

Work branch: `feat/evaluator-v4`, based on facade commit
`19eba808831201672e4798e894c7a2fcbc68f6c6`. Local only; nothing pushed.
The source facade worktree's uncommitted browser fixes remain untouched.

Implementation and integration are complete. **Accuracy acceptance is not met.**
The current validation build is `b701c6e0f`; its immutable copy is
`/tmp/evaluator-v4-freeze`. Gemini 3.8 was selected from development results;
two held-out runs are complete. Residual retrieval/constraint misses, repeat
variance, inference errors, and missing labels prevent adoption on the agreed bar.

## Implementation

- Standalone `packages/evaluator` library and read-only CLI, extracted from the
  exact pinned v3 verifier. `UPSTREAM.json` records source provenance. Evals imports
  the workspace package; its v3 pin remains for existing agent/browser code.
- Direct Google/OpenAI AI SDK client, startup health validation before browser
  allocation, explicit model override, and structured inference errors. Google
  uses temperature zero; OpenAI reasoning models use their supported default.
- Full-trajectory text indexing, complete selected chunks, a 24,000-token default
  evidence budget, and reserved space for batched action arguments. Indexes both
  full identifiers and words inside URL slugs/document filenames.
- Local screenshot hydration and normalization of nested MCP byte arrays, full
  image hashes, native image MIME types, and explicit step/final labels beside
  image payloads. No external factual retrieval occurs.
- `supported`, `contradicted`, `unresolved` outcomes; unresolved never passes.
  Required checks cover stopping boundaries, identity/constraints, and deliverable
  completeness. Outcome stays independent of blocker/process credit.
- Browser-use detection prefers recorded server identity; older traces use a
  documented name fallback. The fired rule is recorded. The browser-use gate still
  applies to supported judgments; proven completion survives later capture errors.
- Additive `health`, `execution`, `failureClass`, and `outcomeChecks` fields. Existing
  trajectory files, outcome/process fields, environment names, and trace support
  remain available. Harbor stays host-side and can consume structured health;
  ATIF and task export are deferred.

Direct Anthropic, Bedrock, and Ollama judge providers are **not ported**. This is a
known compatibility gap; custom `LLMClient` injection remains available. The
current default is Gemini 3.8, pending the acceptance gate.

Generic tables may use explicit row/column delimiters, including inline serialized
rows. Plain prose labelled “Table” does not satisfy a table requirement. Explicitly
requested rendering formats remain mandatory. Dynamic selection rules use the
recorded site state; stale rubric assumptions about expected candidates do not
add candidates excluded by the task. A correctly scoped empty research result
can be supported; a blocked/incomplete search cannot establish absence, and an
unavailable item does not complete a purchase.

## Frozen data and baselines

Artifacts live in `../eval-reconciliation/evaluator-v4/`; original trajectories
and labels are unchanged. `baseline.json` inventories 2,235 rows in 59 heterogeneous
historical groups and records 16 missing/ambiguous/stale audit matches.
These pooled rates describe the inventory, not a comparable leaderboard.

Baseline below is **gated production outcome**:

| Comparison                 |  TP |   TN |  FP |  FN |    FPR |    FNR | Excluded |
| -------------------------- | --: | ---: | --: | --: | -----: | -----: | -------: |
| Confirmed-only primary     | 617 |  987 | 125 | 136 | 11.24% | 18.06% |      370 |
| All-confidence sensitivity | 641 | 1181 | 158 | 156 | 11.80% | 19.57% |       99 |

`development.json` freezes 29 rows from 11 task IDs. Those task IDs are excluded
across every held-out cell. Primary uses high-confidence labels; sensitivity uses
all confidence levels. Six clean Fable development rows lack per-row labels;
aggregate published scores cannot supply them. `heldout.json` contains 142 rows
across five cells. Judge choice preceded all new held-out scoring.
The held-out set has 70 primary labels and 81 sensitivity labels. All 27 Fable
and 34 Sol rows lack saved per-row labels, so neither cell can establish FP/FN
accuracy; their replays measure stability and agreement with disk only.

Compare raw replay with the **ungated disk judge**, not gated production:

| Development comparison     | Gated FP / FN | Ungated judge FP / FN | Labeled |
| -------------------------- | ------------: | --------------------: | ------: |
| Confirmed-only primary     |         6 / 7 |                 7 / 6 |      21 |
| All-confidence sensitivity |         6 / 8 |                 8 / 6 |      23 |

Inference errors are separate from FP/FN. Healthy unresolved results are negative
predictions. Missing labels are excluded, never converted to failures.

## Development evidence and reproducibility

Phase 3 (`a7effe0c5`) measured **chunking only**: its budget remained 3,000 tokens.
`fa3fdf9e9` corrected the budget and retained actual batched arguments. On the
checkout example the packet includes previously omitted fabricated form values
(84 chunks / 90,493 budgeted characters). One-row phase deltas were not established
improvements: the pure port itself flipped 3 of 23 labeled rows against disk.

Nested Cursor screenshots initially consumed the text budget as serialized byte
arrays. Normalization recovers two images on row 26 and reduces text chunks from
1,015 to 72. Another retrieval miss was the Brother warranty filename: before
`055202a06`, the packet omitted `20913_Brother-1-Year-Limited-Warranty-pdf.pdf`.
After indexing compound words it includes evidence #75, step 14, within the same
budget: 90,796 selected characters versus 89,437 before. The exact before/after
packet proof is in `warranty-retrieval-proof.json`.

The shared JSON output examples also contained doubled braces that the renderer
never unescaped. `20a2f3e80` corrects the examples and removes conflicting permissive
rules from the alternate outcome prompt. Two diagnostic Luna rows then produced
complete schema-valid results; this does not claim all schema errors are eliminated.
Image captions/MIME preservation were finalized in `b701c6e0f`.

Completed **exploratory** checkpoints, against unchanged labels:

| Build / run                         | Primary FP / FN / errors | Sensitivity FP / FN / errors |
| ----------------------------------- | -----------------------: | ---------------------------: |
| First repeat build, pass 1          |                3 / 4 / 0 |                    4 / 4 / 0 |
| Same build, pass 2                  |                1 / 3 / 1 |                    2 / 3 / 1 |
| Requirement-review build, pass 1    |                2 / 4 / 0 |                    3 / 4 / 0 |
| Same build, pass 2                  |                2 / 5 / 0 |                    3 / 5 / 0 |
| Filename-indexing build, Gemini 3.8 |                1 / 4 / 0 |                    2 / 4 / 0 |

The first pair flipped 2 of 22 comparable labeled rows (parking-brake and table
failures), plus one unlabeled row. One other row timed out; its exclusion explains
the lower FN count, not an improvement. The requirement-review pair flipped only
the inline-table disconnect row (1 of 23 labels), before the filename retrieval
fix. These pairs are recorded in `final-dev-variance-report.json` and
`review-dev-variance-report.json`. Neither is variance evidence for the current build.

Superseded in-progress comparisons have `interrupted.json` with the reason and
completed-row count. They are ineligible for final selection. Current `freeze-*`
runs share the same compiled build, configuration, and development manifest;
Gemini 3.8 completed twice with **zero verdict flips across 29 healthy rows**
(23 labeled). Both runs have primary 1 FP / 4 FN and sensitivity 2 FP / 4 FN;
the comparable ungated disk baselines are 7 / 6 and 8 / 6 respectively.
`freeze-dev-variance-report.json` records both tables and the empty per-row flip
list. `freeze-dev-gates.json` applies the production gates to all 29 rows: no
additional flips. Cursor rows 23/25/27 become pass/pass/fail; row 23 remains a
label disagreement, so fixing the browser gate alone is not counted as accuracy.
The disconnect row passes with `browser_session_lost` retained in diagnostics.
The compiled build hash is
`6ccbf2a928fd3ec3b33b0f272e69647d1fd4d6cfda31d06066a68fb1d9af912d`.
Final judge comparison (`freeze-judge-report.json`), with unchanged labels:

| Judge                   | Primary FP / FN / errors | Sensitivity FP / FN / errors | All-row errors |
| ----------------------- | -----------------------: | ---------------------------: | -------------: |
| Gemini 3.5 Flash        |                3 / 1 / 8 |                    4 / 1 / 8 |              9 |
| Luna                    |                0 / 5 / 4 |                    0 / 6 / 4 |              4 |
| Gemini 3.8 Flash        |                1 / 4 / 0 |                    2 / 4 / 0 |              0 |
| Gemini 3.8 Flash repeat |                1 / 4 / 0 |                    2 / 4 / 0 |              0 |

Gemini 3.8 was selected at **2026-09-05 22:14:23 UTC**, before starting any new
held-out scoring. `judge-choice.json` freezes the rationale, model, build, config,
and report hash. Selection considers healthy results, constraint handling, the
disconnect ruling, and variance; Luna's label agreement alone is circular, and
its apparent zero FP excludes four inference errors. Held-out runs once plus an
unchanged repeat, concurrently with four workers each. No tuning on held-out.

## Held-out result: acceptance not met

`freeze-heldout-report.json` contains full tables, cell results, per-row reasoning,
and variance. `freeze-validation-summary.json` also records production-gate checks.
These are **raw judge** results against unchanged labels. Gated and ungated disk
baselines happen to agree on this set; applying the new production gates causes
no additional flips in either replay.

| Comparison                         | Primary FP / FN / labeled errors | Sensitivity FP / FN / labeled errors | All-row errors |
| ---------------------------------- | -------------------------------: | -----------------------------------: | -------------: |
| Disk judge (= gated baseline here) |                        2 / 0 / 0 |                            4 / 1 / 0 |              0 |
| Frozen Gemini 3.8, pass 1          |                        1 / 3 / 3 |                            4 / 4 / 3 |              4 |
| Same build, pass 2                 |                        1 / 4 / 1 |                            3 / 5 / 1 |              1 |

Primary FPR/FNR: baseline 4.35% / 0%; pass 1 2.22% / 13.64%; pass 2
2.17% / 17.39%. Sensitivity FPR/FNR: baseline 7.55% / 3.57%; pass 1
7.69% / 15.38%; pass 2 5.66% / 18.52%. Errors are excluded from those rate
denominators and shown explicitly; fewer scored rows do not establish improvement.

| Held-out cell | Rows / sensitivity labels | Disk FP / FN | Pass 1 FP / FN / errors | Pass 2 FP / FN / errors |
| ------------- | ------------------------: | -----------: | ----------------------: | ----------------------: |
| Fable 5.1     |                    27 / 0 |          N/A |                     N/A |                     N/A |
| Grok 4.6      |                   27 / 27 |        2 / 1 |               3 / 1 / 2 |               3 / 1 / 0 |
| Sol           |                    34 / 0 |          N/A |                     N/A |                     N/A |
| Astra         |                   27 / 27 |        2 / 0 |               1 / 3 / 1 |               0 / 4 / 1 |
| GLM 5.3       |                   27 / 27 |        0 / 0 |               0 / 0 / 0 |               0 / 0 / 0 |

There are **7 verdict flips / 138 healthy comparable rows**, including **3 / 78
labeled rows**. Labeled flips: row 16 (parking date, pass→fail), row 31 (vitamin
quote, pass→fail), row 51 (grill size/style, pass→fail). Unlabeled flips: rows
92, 132, 133, 136. Four rows have an error in at least one run. Pass 1 has two
timeouts and two JSON parse failures; pass 2 has one timeout, also present in pass 1.
No selective inference retries were substituted into these tables.

Fable's raw pass count changes from 24/27 to 14/27 and 15/27 (both healthy).
The ten disk passes rejected in pass 2 cite five table-format/completeness misses,
three blocked purchases, one size substitution, and one missing carrier-price
comparison. Sol changes from 19/34 to 20/34 in each replay, with one pass-1 error.
These are outcome changes, not labeled accuracy estimates. Missing labels prevent
the requested clean-cell non-regression claim.

Four sensitivity FNs in both replays are positive labels for blocked/incomplete
purchases (rows 26, 46, 49, 53; three tasks). They remain in the tables despite the
completion-versus-process policy conflict. Pass 2 adds the genuine quote-retrieval
FN. The FPs include disputed audit reasons and unstable constraint misses detailed
below; no post-hoc corrected zero-FP result is claimed.

Run stamps include the actual compiled JavaScript hash, replay-script hash,
dependency versions, Node/platform/architecture, config, model, manifest hash,
commit, and timestamp. Earlier runs lacking these fields are explicitly historical.
`report.py` reports both baselines, confidence tables, cell results, errors, and
per-row flips with build/config equality checks.

## Label disagreements and compatibility

`development-adjudications*.json` preserves answers and audit reasons; label
overrides remain empty. Four positive labels (rows 0, 1, 2, 28; three tasks) award
blocker/process credit although the requested purchase/comparison was not completed.
Those raw FNs remain in both tables.

The Gemini tire FPs are rows 7 and 23. Row 23's audit says candidate (b) was omitted,
but the saved answer includes Nexen Aria AH7, $118 each, $472 for four, and its
missing 3PMSF attribute. Row 7 reports the lowest displayed price and discloses a
lower metadata price with hidden purchase pricing; similarly qualified row 11 has
a positive label. The rubric explicitly permits a verified price bound and
“cheapest verified” wording. These require consistent adjudication; no adjusted
0/0 is claimed. Luna produced the audit labels, so agreement is not independent
validation and cannot alone justify choosing Luna.

`heldout-evidence-review-final.json` records read-only inspection after selection,
without label overrides or implementation changes:

- Row 4's negative audit says only two vitamin products were delivered; the saved
  answer has three. Disproving that reason does not automatically adjudicate all
  task constraints.
- Row 9's expected YARTS 140-2 travels toward Merced in the recorded schedule;
  the task requires travel toward Yosemite. The next inbound run arrives after
  the program. The audit's expected-run assertion conflicts with saved evidence.
- Row 12's Best Buy $799.99 price is in step 9. Microsoft's earlier $749.99 is
  associated with the white digital model; step 16 shows Carbon Black selected
  with $799.99 ERP. The audit overlooks the later variant selection.
- Row 16 is a real date-consistency miss: one run passes parking for a past date
  despite the site falling back to Today; the repeat catches it.
- Row 31 is a real retrieval miss: `Vitamin D3 (as cholecalciferol from algae)`
  appears in step 16's tool output, but the selected packet includes only that
  step's first 1,972 text characters. The quote-bearing chunk is omitted. One run
  passes; the repeat calls the quote fabricated. Its packet selected 69 of 488
  chunks / 81,526 characters. A larger budget alone has not closed retrieval.
- Row 51 is a constraint-check miss: one run accepts a BBQ03SI grill without
  establishing the requested medium size; the repeat flags the unverified
  size/Argentine-style identity and fails it.

The last three findings prevent a claim of reliable zero intrinsic FP/FN. A next
iteration should strengthen claim-specific retrieval and date checks using
development evidence, then validate on fresh untouched tasks with usable labels;
these exposed held-out rows cannot serve as a new blind acceptance set.

Saved compatibility sources were recorded early in `compatibility.json`.
`compatibility-replay.json` contains six distinct saved trajectories across
WebTailBench/OdysseysBench, plus one generated-rubric variant per benchmark.
Generating a rubric is an explicit replay-only variant, not fabricated historical
provenance. The final frozen compatibility replay has eight healthy results and
agrees with seven of eight saved outcomes; neither generated-rubric variant errors.
`freeze-compatibility-report.json` records results and build provenance.
The changed OdysseysBench
outcome concerns a hotel page overwritten despite an instruction to leave it open;
its correctly scoped empty event search receives credit. Saved outcomes are
compatibility references, not independently adjudicated ground truth.

## Checks and reproduction

34 evaluator tests (including pinned-result parity) and 79 focused evals tests pass.
Checks cover deep 100KB+ retrieval, filename retrieval, embedded screenshots,
image captions/MIME types, browser identity, bare answers, explicit outcome checks,
dead-model startup before browser allocation, persistence, and rubric resolution.
Build/type-check tasks are registered in Turbo; evals depends on the evaluator
build. Formatting passes; lint has no errors and two warnings in extracted legacy
code. Direct replay uses Node 23.11; pnpm uses managed Node 24.18.

See `packages/evaluator/README.md` for CLI/library use. Reproduce the disk baseline
with `packages/evals/scripts/audit/evaluator-baseline.py`; run inference with
`packages/evaluator/scripts/replay.mjs --manifest <frozen.json> --out <new-dir>
--model <provider/model> --jobs 2`; compare with `scripts/report.py --manifest ...
--baseline ... --runs ... --out <new.json>`. Outputs must be new paths. Source files
are hash-checked and never overwritten.

## Takeover iteration (2026-09-05 evening) — after Codex's frozen validation

Owner rulings applied: rubric governs process, outcome means completion; bot-walled / blocked
runs get process credit, fail outcome, and are excluded from capability (corrected) scores.
Labels are never edited; disagreements stay visible.

**Labels completed.** `hardbench-audit-luna.py` was run on the two unlabeled held-out cells
(fable-5-1 `…112444`, sol `…093026`); verdicts under `/tmp/eval-night/audits/<group>/`.
Relabeled baseline: `../eval-reconciliation/evaluator-v4-relabel/baseline.json`. The fresh
single-pass audit disagrees with the 09-02 calibration: fable shows 7 high-confidence FPs among
28 disk passes (calibration said 0). Treat luna labels as noisy; report confirmed and sensitivity.

**Held-out (Codex's 142 rows) re-cut with all labels, env/unachievable exclusions
(`evaluator-recut.py`).** Sensitivity: disk 15 FP / 5 FN → frozen build 11 FP / 13 FN (pass 2).
FP classes: 5 fable rows are inline pipe-delimited answers luna calls "not a table" (policy conflict
with the inline-table reading — owner ruling pending); 2 disputed medium tire labels; fabricated
price (flip); 3 sol misses (wrong datum, filters not applied, omitted equal-price product).
FN classes: item-unavailable-with-disclosure (Walgreens ×2), login wall / hCaptcha blockers the
judge saw but `executionIssues()` did not, exact-quote retrieval miss (vitamin row), disclosed
size substitution, two identity disputes.

**Code changes (commits a9e3aa1aa, 72b7e20af, db3f4b91a).**

- Answer anchors (`retrieval.ts`): exact quotes, money values and identifiers from the final
  answer are scanned against every recorded observation chunk (never agent text / actions);
  located chunks are force-included, unlocated claims are reported to the judge. Contradiction
  now requires positive evidence; absence from the selected excerpts alone is unresolved.
- Optional `goal_achievability` outcome check → `failureClass` `goal_unachievable`
  (item not sold / not purchasable) or `site_blocked` (login wall, CAPTCHA, error page seen only
  in page content). Outcome still fails; downstream excludes the row from capability scores.
- Policy: enumerate every explicit constraint against recorded final state; relative dates tolerate
  the one-day UTC-vs-browser-local boundary; opening a source page is not a deliverable.
- `packages/evals/scripts/audit/evaluator-recut.py`: confirmed/sensitivity cuts with environment
  and unachievable exclusions that are label-aware (an evaluator claim never hides a confirmed
  genuine fault; those cases are counted separately).

**Results, build 72b7e20af (`take2-*`, gemini-3.8-flash), sensitivity cut:**

| Set                                                                                   | Disk FP / FN | New FP / FN (pass 1) | New FP / FN (pass 2) |   Flips |
| ------------------------------------------------------------------------------------- | -----------: | -------------------: | -------------------: | ------: |
| Dev (29)                                                                              |        7 / 7 |                4 / 1 |                3 / 0 |  1 / 29 |
| Fresh held-out `heldout2.json` (135; sonnet-5, composer, gemini-3.8, muse, glm-flash) |       14 / 7 |                7 / 6 |                8 / 7 | 4 / 133 |

Remaining dev misses are the disputed tire labels and one inline-table row. Fresh held-out misses
that motivated db3f4b91a: constraints accepted without an observation (dates, F-150 garage, hostel
search state), the UTC/local "tomorrow" boundary, and one sourcing-only failure. Because those rows
were read, the `take3-heldout2-posthoc` rerun is post-hoc and is NOT an acceptance number; a third
fresh set `heldout3.json` (135 rows; sonnet-5 000040, gemini-3.7, gemini-3.5, muse, glm-flash)
provides the acceptance measurement for db3f4b91a. Results appended below when complete.

Open owner rulings that decide the remaining labeled disagreements: (1) does an inline
pipe-delimited answer satisfy "a table"; (2) disclosed substitution / closest alternative when the
requested item is unavailable — pass, or fail-but-excluded; (3) the America's Tire "cheapest
verified with disclosed hidden cheaper candidate" label.

### Takes 3 and 4 (builds db3f4b91a, 619b0a220), gemini-3.8-flash, common comparable rows

Sensitivity cut, ungated disk judge as baseline, identical row set per table (`evaluator-recut.py`).
Caveat that applies to every "fresh" set: no labeled cell covers tasks outside the 45 already used, so
held-out-2/3 differ from the earlier sets by model and harness only, not by task.

| Set (common rows)                                                          | Disk judge FP / FN | take3 FP / FN |        take4 FP / FN | take4 flips |
| -------------------------------------------------------------------------- | -----------------: | ------------: | -------------------: | ----------: |
| Dev (20)                                                                   |              8 / 2 |         3 / 0 |  3 / 0 (both passes) |      0 / 29 |
| Held-out-3 (104; sonnet-5 000040, gemini-3.7, gemini-3.5, muse, glm-flash) |             15 / 5 |      12 / 3–4 | 13 / 1 (both passes) |     0 / 131 |

take4 (tool-derived agent text tagged as observation + money anchors) recovered two FNs (both exact
claims that retrieval had dropped) and added one FP (parking task, booking reached Secure Checkout).
Remaining held-out-3 FPs: 3 inline pipe-delimited "table" rows (owner ruling; luna labels this
inconsistently within the same set) and 10 genuine misses on weak-model runs where the fused
judge accepted the agent's fluent summary: critical point crossed (2 rows, same task), a size
qualifier asserted but never shown (3 rows, same task), wrong store name, wrong retailer's price,
wrong search parameter, omitted required field, "purchased" claim at checkout, added wrong
comparison data, deliverable without the requested costs. Anchors cannot catch these because the
wrong values genuinely appear somewhere in the observations. Proposed next structural change:
decompose the task into an explicit requirement checklist (fields, qualifiers, constraints, critical
point) in a separate step and verify each item against cited evidence individually, instead of one
fused judgment over the whole packet (the UV paper's fixed-rubric shape that reached zero FP).

### Label quality pass and two-vote labels (2026-09-05, late)

Manifests: all four sets pass integrity checks (no duplicate rows, no dev-task leakage, no row reuse
across held-out sets, all run dirs and file hashes present, every row mapped to a per-row luna verdict,
no label stale against the disk verdict it audited). Structural caveat unchanged: every set draws from
the same 45 tasks.

Labels: luna's verdicts were internally inconsistent on one rule — whether a delimited answer on one
line is a "table" — failing 19 of 27 inline-delimited answers and passing 8, and passing 11 prose
answers where the rubric says a table is required. Owner rulings (2026-09-05): (1) any consistent
delimited structure satisfies a generic table requirement, prose does not; (2) disclosed fallback
passes only when the rubric's fallback clause allows it, and is categorized `disclosed_fallback`;
(3) the America's Tire "cheapest verified + disclosed hidden-price candidate" answer passes.
`label-overlay.py` applies (1) and (3) mechanically (17 rows; luna files untouched); the evaluator
applies (1) via a deterministic `answerStructure()` classification injected into the judge prompt.

An independent second vote (claude-sonnet-5, `/tmp/eval-night/second-vote/out`, all 441 rows)
agrees with luna on 379 rows and splits on 45 (40 of them luna=fail / claude=pass). `two-vote-overlay.py`
combines: ruling > agreement (confirmed) > split (disputed, sensitivity only).

**On confirmed labels the picture changes.** Most rows previously counted as FPs, for the disk judge
and the new one alike, were luna-only claims the second voter did not confirm:

| Set (common rows) | Disk judge FP / FN, confirmed | New build FP / FN, confirmed | New build FP / FN, all labels |
| ----------------- | ----------------------------: | ---------------------------: | ----------------------------: |
| Dev (20)          |                         2 / 2 |                0 / 0 (take4) |                         1 / 0 |
| Held-out-2 (105)  |                         1 / 2 |          2 / 9 (take2 build) |                         7 / 9 |
| Held-out-3 (108)  |                         1 / 7 |                2 / 4 (take4) |                        10 / 4 |

Confirmed FPs remaining on take4: wrong grill style (Tagwood) and the other retailer's price
(Best Buy/Microsoft). Confirmed FNs: three inline-table rows the judge still failed on format
(fixed by the deterministic classifier, pending take6 replay), one rental-car identity dispute,
and on the older take2 build: disclosed fallback (now categorized), partial comparison the rubric
allows, a sourcing-only fail, and the UTC/local "tomorrow" boundary (all addressed in later builds).

### Final state of this iteration — take6 (commit 47361c7cc), confirmed labels (two-vote + rulings)

| Set (common rows)                                               | Disk judge FP / FN |         take6 FP / FN | take6 flips |
| --------------------------------------------------------------- | -----------------: | --------------------: | ----------: |
| Dev (20)                                                        |              3 / 2 |                 1 / 0 |           — |
| Held-out-2 (104, post-hoc: its rows were read before takes 3–6) |              1 / 2 |                 2 / 4 |           — |
| Held-out-3 (106)                                                |              2 / 7 | 2 / 3 (pass 2: 3 / 3) |     2 / 130 |

Remaining confirmed FPs (both voters fail, judge passes): wrong grill style (Tagwood), the other
retailer's price reported as Microsoft's, wrong travel dates (Sep 5–8 vs 6–9), a garage that cannot
take the requested F-150 recommended and accepted as a disclosed fallback. All four are explicit
constraints or identities accepted from a fluent final answer. Remaining confirmed FNs: the judge's
deliverable_completeness check rejecting complete tables (vitamin ×2, peanut butter), a partial
comparison the rubric allows, one disclosed-fallback cover, and one rental-car identity dispute.

Reading: on confirmed labels the disk judge's FP rate was already ~1–2% and most earlier "FP" counts
were luna-only claims. The new evaluator is at FP parity, better on FN where labels are clean
(held-out-3), and is deterministic (0–2 flips per ~130 rows), with structured health, outcome
states, failure classes, answer anchors and the harness/evidence defects fixed. Zero confirmed FP is
not met; the remaining class needs the per-requirement checklist decomposition described above.
Acceptance decision is the owner's. The 52 two-vote splits (`two-vote-splits.md`) are the other
lever: 40 of them are luna-fail / claude-pass.

### Review fixes and take7 (commit 90809e4fd), 2026-09-06

Review findings fixed: (1) answer-structure classifier — HTML requires `<tr>`, URLs masked before
delimiter counting, CSV rows recognized, two consistent records count, negative tests; its authority
in the prompt is limited to the format question. (2) Label overlay — regex rules removed; only
hash-checked explicit adjudications apply (2 tire rows the owner ruled on); table-rule rows are
emitted as second-vote-gated candidates for review (3), never auto-applied. (3) Fallback exception
waives only the requirement the rubric clause covers; every other constraint still binds.

Both views are reported. "Filtered" removes rows the evaluator classifies environment / unachievable
(a policy choice from the bot-wall ruling); "full set" keeps every labeled healthy row.

| Confirmed labels (two-vote + 2 adjudications)    | Old ungated judge FP / FN |               take7 FP / FN |
| ------------------------------------------------ | ------------------------: | --------------------------: |
| Dev, filtered (20) / full (29)                   |             2 / 2 · 2 / 5 |               0 / 0 · 0 / 4 |
| Held-out-2 post-hoc, filtered (101) / full (130) |             1 / 2 · 1 / 3 |               2 / 4 · 2 / 8 |
| Held-out-3, filtered (105) / full (128)          |             1 / 4 · 1 / 4 | 2 / 2, 3 / 3 · 2 / 6, 3 / 7 |

take7 flips: 2 / 130. Conclusion: on confirmed labels the new evaluator does NOT beat the old judge
on the full set (FP parity to slightly worse, FN worse). Structural gains stand (deterministic,
fail-loud health, outcome states, failure classes, evidence tiering, anchors, five inherited defects
fixed). Remaining full-set confirmed misses decompose as: FN — unavailable-item rows with explicit
rubric fallback clauses that the judge marks `unachievable_established` instead of
`unachievable_fallback_accepted` (Ocean State ×3, Walgreens; the owner's fallback ruling says these
pass), plus deliverable strictness on complete answers (vitamin ×2, peanut butter, UPS partial),
one sourcing-only fail; FP — wrong grill style, other retailer's price, wrong dates, F-150 garage.
Post-take7 commit adds a deterministic rule (unachievable/blocked ⇒ never supported) that closes the
F-150 FP class; it is unit-tested but not yet replay-validated.

### Rubric v1.2 + take9 (commit 6f27cc047) — final measurement, 2026-09-06

Ground truth: all 441 rows confirmed and made consistent with the v1.2 conventions — 344 by luna/claude
agreement, 97 by owner rulings, evidence-verified adjudications, or mechanical convention (30 prose-
where-table-required → fail; 10 judge-corroborated site blockers → fail/environment). Completed-before-
disconnect rows stay PASS (owner ruling). No luna-only label remains in the primary table.

Evaluator: anchors, tiered evidence, achievability states (fallback / unachievable / environment),
deterministic answer-structure classification with the table convention enforced in code, rubric
fallback-clause scan, unachievable-never-supported rule; judge gemini-3.8-flash; rubrics v1.2 via
`--rubric-overrides`.

| Set (comparable rows)                  | Old v3 judge FP / FN | take9 FP / FN | take9 FPR / FNR |
| -------------------------------------- | -------------------: | ------------: | --------------: |
| Dev, full (27)                         |                5 / 0 |         0 / 2 |        0% / 18% |
| Held-out (Codex), full (135)           |               17 / 4 |         7 / 7 |        9% / 12% |
| Held-out-2, full (126)                 |               21 / 4 |         5 / 3 |         6% / 6% |
| Held-out-3, full (128)                 |               18 / 6 |         5 / 3 |         6% / 7% |
| Held-out-2, environment excluded (98)  |               19 / 2 |         4 / 2 |         7% / 5% |
| Held-out-3, environment excluded (109) |               16 / 4 |         4 / 2 |         6% / 5% |

Remaining misses (all sets, full view): 15 FP of the constraint/datum class (wrong dates ×3, wrong
retailer's price ×2, grill style, garage that cannot fit the vehicle, children=0 search, omitted
required field ×2, ZIP handling ×2, Source-URL column, near-miss tire size, rank-walk datum); 2 FP on
blocker-relabeled rows the judge passes under the fallback (disputed); 9 FN where the judge is
stricter than both graders (sourcing-only, partial-credit clauses, two runs that ended in sdk_error /
disconnect); 5 FN environment rows; 1 fallback not applied. Zero FP is met on dev only. Held-out FPR
fell from 13–17% to 6–9%; FNR is 6–12%. The constraint/datum class is unchanged across nine builds and
needs the per-requirement checklist decomposition, not prompt work.

### Rebased onto the consolidated stack (2026-09-27)

Branch `feat/evaluator-v4-consolidated`: the 48 evaluator commits replayed onto `integration/consolidated-top`
(= evals/consolidation-18 + sibling heads 04 and 12, merged locally; assumed landing state). The stack's
`consolidation-01-hardbench` already ships rubric v1.2 with the same six conventions
(`RUBRIC-CLARIFICATIONS.md`) on a 102-task dataset (core + extended); my duplicate dataset edit and
`RUBRIC-CLARIFICATIONS-2026-09-06.md` were dropped in favour of the stack's, and replays use
`rubric-overrides-stack-v1.2.json` generated from the stack's dataset. `rubric-clarify.py` is kept as the
reproducible procedure. Conflict resolutions kept the stack's additions (model override, captured
trajectory for diagnostics, CUA imports, error sanitizing) on top of the standalone-evaluator rewire.
Post-rebase reconciliation: gates accept v3-style verdicts (judge pass = supported when no outcomeState) and
let a structured `supported` state stand without a final answer; an explicit judge override fails loud
without its provider key (`loadApiKeyFromEnv` exported from the evaluator); a failed verification is
ungraded (no outcomeSuccess/processScore) per the stack's runner contract; `Evaluator` creates its model
clients lazily so harness setup never needs credentials. Verification: evaluator 42 tests, evals 1005 tests,
turbo typecheck clean; frozen dev replay on this build with the stack's v1.2 rubrics reproduces take9
verdict-for-verdict (29/29; 0 FP / 2 FN on v1.2-consistent labels).

### GPT-6 judges (2026-09-27, consolidated build, stack rubric v1.2, confirmed labels)

| Judge            | Dev full FP / FN (20) | Held-out-3 full FP / FN (109) | Held-out-3 filtered FP / FN (81) | Errors (135) | Median latency |
| ---------------- | --------------------: | ----------------------------: | -------------------------------: | -----------: | -------------: |
| Old v3 judge     |                 5 / 0 |                        15 / 5 |                           14 / 3 |            0 |              — |
| gemini-3.8-flash |                 0 / 2 |                         4 / 2 |                            3 / 1 |            7 |           25 s |
| gpt-6-sol        |                 0 / 5 |                        1 / 30 |                           1 / 24 |            6 |           29 s |
| gpt-6-luna       |                 0 / 5 |                        0 / 32 |                           0 / 26 |           16 |           37 s |

GPT-6 judges reach the zero-FP target but fail ~85% of true passes. The FNs are not schema
artifacts (states are valid): they mark identity_and_constraints "unresolved" on ~20 rows (qualifiers
not proven to their standard) and deliverable_completeness "contradicted" on ~15 (non-verbatim
ingredient lists, a mislabeled observed value, an omitted promotion). Under the policy "any unresolved
required check blocks a pass", a highly cautious judge collapses recall. Label caveat: luna (5.6)
voted on every confirmed label; the GPT-6 luna-family judge is not independent of them, which if
anything flatters its FP count. Recommendation: gemini-3.8-flash stays the production judge; gpt-6-sol
is a candidate for a veto/second-opinion mode where zero FP matters more than recall.

## Autoresearch on a fresh corpus (2026-09-29 → 09-30)

The September labeled trajectories were removed from disk, so accuracy work moved to a fresh sample
of ~3,400 scored HardBench runs (17 agent models) never used for tuning. Labels are **blind**: two
independent grader agents (`scripts/audit/label-blind.py`, codex and claude backends) read each
trajectory under the v1.2 policy without seeing any verdict; only rows where both agree count.
Splits are by task: dev (78 rows), test (162), confirm (42), and test2 (128 fresh runs of non-dev
tasks, used to validate the screenshot selector that was designed after reading test rows).
Constraint: LLM calls, tokens, and wall time per row must not exceed today's verifier.

Cost anatomy (from traces): per-screenshot relevance scoring was 83–92% of judge calls (~10 per row);
the judgment itself is one call (~40k input, ~1.4k output, ~2–3k reasoning tokens).

Pooled held-out result (test + test2, 223 confirmed rows, gemini-3.8-flash judge):

| Evaluator                                         | Correct |  FP |  FN |    F1 | LLM calls/row | Median s |
| ------------------------------------------------- | ------: | --: | --: | ----: | ------------: | -------: |
| Stack V3 verifier (on-disk verdicts)              |     198 |   6 |  19 | 0.880 |           ~20 |      ~50 |
| This package, LLM-scored screenshots              |     205 |   5 |  13 | 0.916 |           ~11 |    15–28 |
| This package, `recency`                           |     203 |   6 |  14 | 0.907 |             1 |       ~8 |
| This package, `signals` (K=6) + thinking cap 1024 |     209 |   5 |   9 | 0.936 |             1 |     ~8.4 |

Paired: `signals` vs stack V3 18–7 discordant rows (McNemar p = 0.04); vs `recency` 6–0 (the test
portion is confounded by the JSON-deliverable fix landing between those builds; on test2 alone 2–0);
vs LLM-scored screenshots 6–2. The stack verifier disagreed with its own verdicts on 6 of 77 rows when
rerun on identical inputs.

Rejected with evidence: a stricter judge as a veto (recall collapses), the per-task requirement
checklist (more FP and FN on dev), skipping optional output sections, the relaxed decision rule
(trades FN for FP), and local OCR evidence (no dev gain, p90 time ×1.8). Fixes found along the way:
the table rule matched appended convention text and read JSON deliverables as prose; an anchor
"not found in text" escalated to a contradiction; judgment timeouts left rows ungraded.

Recommended defaults (not yet applied): `VERIFIER_IMAGE_SELECTION=signals`,
`VERIFIER_SIGNAL_IMAGES=6`, `VERIFIER_THINKING_BUDGET=1024`.

Tooling: `fresh-corpus-sample.py` (task-split, verdict-balanced sampler), `label-blind.py` (blind
graders), `fresh-score.py` (F1, FPR, calls, tokens, latency per arm), `packages/evaluator/scripts/replay.mjs`
(frozen-manifest replays with build and rubric stamps).
