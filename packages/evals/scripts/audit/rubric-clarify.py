#!/usr/bin/env python3
"""Append rubric v1.2 conventions without changing task questions or cohort metadata.

Explicit input/output paths are required; existing outputs need --overwrite.
The optional --overrides output contains task-ID to rubric mappings, independent
of any evaluator implementation. This is an authoring tool, not a relabeler.
"""
import argparse
import copy
import json
from pathlib import Path
import re

CONVENTIONS = {
  "table-format": (
    re.compile(r"\btable\b|tabular", re.I),
    " Format convention: any consistent delimited structure (a markdown or HTML table, or pipe-, semicolon- or comma-separated records with the same fields per record, even on a single line) satisfies the table requirement; unstructured prose does not. Every required column/field must still be present."),
  "fallback-vs-blocker": (
    re.compile(r"unavailab|out of stock|no exact match|closest (available )?alternative|inaccessib|blocked|blocker|technical error|login wall|captcha|site error|impossible", re.I),
    " Fallback convention: if the requested item is not offered, out of stock, or has no exact match on the site, and the final answer discloses this and takes the closest alternative this criterion allows, the criterion is fully satisfied and the task outcome counts as complete under the fallback. If the site itself is inaccessible (bot wall, CAPTCHA, error page, login wall, crash), report the blocker: process credit applies, but the outcome is not complete and the run is an environment failure, not a capability failure."),
  "critical-point": (
    re.compile(r"critical point|stop(ping|s)? before|checkout|payment|personal information|binding transaction|place (the |an )?order|complete (the |a )?(purchase|reservation|booking)", re.I),
    " Critical-point convention: reaching a cart, checkout, or booking page without entering personal or payment information and without submitting an order or reservation is stopping before the critical point. Entering such information, or submitting, crosses it."),
  "source-authority": (
    re.compile(r"compar(e|ison|ing)|from (at least )?(one|two|another) (other )?(retailer|carrier|site|service)|competitor", re.I),
    " Source convention: a value about a retailer, carrier, or venue must come from that entity's own page when the trajectory visited it; another company's comparison table is not an authoritative source for that entity's prices or terms."),
  "relative-dates": (
    re.compile(r"\btomorrow\b|\btoday\b|this coming|this weekend|next (month|day|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\bmonth\s+after\s+next\b|run date|following (day|friday|saturday|sunday|monday|tuesday|wednesday|thursday)", re.I),
    " Date convention: relative dates resolve against the date the agent's browser showed during the run; a one-day difference from the run's UTC timestamp is not an error."),
}

# Targeted fixes where a criterion's wording conflicts with the task-level deliverable.
TARGETED = {
  "47e314cc452c540524ffb7cf520285a3": [
    ("Identify parks offering paddling permits and their costs",
     " Deliverable convention: the task asks only for the park; the permit costs are supporting evidence for process credit. A final answer naming the correct park satisfies the outcome even if costs are not restated."),
  ],
}


def clarify_rows(rows):
    """Return independent rows; validation completes before any files are written."""
    result = copy.deepcopy(rows)
    ids = set()
    for row in result:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not row["id"]:
            raise ValueError("Every row must have a nonempty string id")
        if row["id"] in ids:
            raise ValueError(f"Duplicate task id: {row['id']}")
        ids.add(row["id"])
        if not isinstance(row.get("ques"), str) or not row["ques"].strip():
            raise ValueError(f"Missing question: {row['id']}")
        rubric = row.get("precomputed_rubric")
        if not isinstance(rubric, dict) or not isinstance(rubric.get("items"), list) or not rubric["items"]:
            raise ValueError(f"Missing rubric items: {row['id']}")
        applied = set(row.get("clarifications", []))
        for item in rubric["items"]:
            if not isinstance(item, dict) or any(not isinstance(item.get(k), str) or not item[k].strip() for k in ["criterion", "description"]):
                raise ValueError(f"Malformed criterion: {row['id']}")
            # Added conventions must not become new keyword triggers on replay.
            description = item["description"]
            original = description
            for _, sentence in CONVENTIONS.values():
                original = original.replace(sentence, "")
            for _, sentence in TARGETED.get(row["id"], []):
                original = original.replace(sentence, "")
            text = f"{item['criterion']} {original}"
            for name, (pattern, sentence) in CONVENTIONS.items():
                if sentence.strip() in description:
                    applied.add(name)
                elif pattern.search(text):
                    description = description.rstrip() + sentence
                    applied.add(name)
            for criterion, sentence in TARGETED.get(row["id"], []):
                if item["criterion"] == criterion:
                    if sentence.strip() not in description:
                        description = description.rstrip() + sentence
                    applied.add("targeted")
            item["description"] = description
        if applied:
            row["rubric_version"] = "1.2"
            row["clarifications"] = sorted(applied)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--overrides", type=Path)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    outputs = [p for p in [args.out, args.overrides] if p is not None]
    if any(p.resolve() == args.dataset.resolve() or
           (p.exists() and args.dataset.exists() and p.samefile(args.dataset)) for p in outputs):
        parser.error("Dataset and output paths must differ")
    if len({p.resolve() for p in outputs}) != len(outputs):
        parser.error("Output paths must differ")
    if any(p.exists() for p in outputs) and not args.overwrite:
        parser.error("Output exists; choose a new path or pass --overwrite")
    rows = [json.loads(line) for line in args.dataset.read_text().splitlines() if line.strip()]
    updated = clarify_rows(rows)
    args.out.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in updated))
    if args.overrides:
        args.overrides.write_text(json.dumps({row["id"]: row["precomputed_rubric"] for row in updated}, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"tasks": len(rows), "changed": sum(a != b for a, b in zip(rows, updated))}))


if __name__ == "__main__":
    main()
