#!/usr/bin/env python3
"""Re-cut replay verdicts against audit labels with explicit policy overlays.

  python3 evaluator-recut.py --manifest heldout.json --baseline baseline.json --runs dirA dirB ... [--disk]

Tables per run: confirmed-only primary (high-confidence labels) and all-confidence sensitivity.
`--disk` adds two baselines: the gated on-disk outcome and the ungated on-disk judge verdict (the
like-for-like comparison for raw replay output). All columns are computed over ONE common row set:
a row excluded under any source is excluded for every source.
Rows are excluded (and counted) when the evaluator classified the run as environment or an
unachievable goal (`result.failureClass` in {site_blocked, browser_session_lost, goal_unachievable}),
or when the audit classified the row as environment. Verifier errors (health != healthy) are
excluded from FP/FN and counted separately. Labels are never modified; disputed rows are listed.
"""
import argparse, collections, json, os

ENV_CLASSES = {"site_blocked", "browser_session_lost"}

def load_result(run_dir, i):
    p = os.path.join(run_dir, f"{i}.json")
    if not os.path.exists(p):
        return None
    r = json.load(open(p))
    return r.get("result") or {}

_verdict_cache = {}
NO_EXCLUSIONS = False
def audit_classification(row, b):
    """luna's classification (genuine_fault / environment / ...) for fail rows, from the audit verdicts file."""
    audit = b.get("audit")
    if not audit:
        return None
    path = audit if audit.endswith("verdicts.json") else os.path.join(os.path.dirname(audit), "verdicts.json")
    if path not in _verdict_cache:
        try:
            _verdict_cache[path] = {v.get("id"): v for v in json.load(open(path))}
        except Exception:
            _verdict_cache[path] = {}
    by_id = _verdict_cache[path]
    v = by_id.get(f"{row['taskId']}/{os.path.basename(row['run'])}") or by_id.get(row["taskId"]) or {}
    return v.get("classification")

def cut(rows, labels, verdict_fn, confirmed):
    c = collections.Counter(); misses = []
    for i, row in enumerate(rows):
        b = labels.get(row["id"]) or {}
        lab = b.get("label"); conf = b.get("confidence")
        v = verdict_fn(i, row, b)
        if v is None:
            c["missing"] += 1; continue
        out, health, fclass = v
        if health != "healthy":
            c["errors"] += 1; continue
        if lab is None:
            c["unlabeled"] += 1; continue
        if confirmed and conf != "high":
            c["excluded_confidence"] += 1; continue
        # Environment blockers are excluded regardless of label. An evaluator claim that the goal was
        # unachievable is excluded only when the audit did not confirm a genuine failure (label False):
        # a judge must not hide a confirmed capability fault behind "the site couldn't do it".
        # luna's own environment classification always excludes. The evaluator's environment class
        # excludes only when the audit did not confirm a genuine failure: a late session loss in an
        # already-failing run must not launder a capability fault.
        if NO_EXCLUSIONS: pass
        elif audit_classification(row, b) == "environment":
            c["excluded_environment"] += 1; continue
        elif fclass in ENV_CLASSES:
            if lab is False and audit_classification(row, b) == "genuine_fault":
                c["environment_claim_on_confirmed_fail"] += 1
            else:
                c["excluded_environment"] += 1; continue
        if not NO_EXCLUSIONS and fclass == "goal_unachievable" and lab is not False:
            c["excluded_unachievable"] += 1; continue
        if fclass == "goal_unachievable":
            c["unachievable_claim_on_confirmed_fail"] += 1
        k = ("T" if out == lab else "F") + ("P" if out else "N")
        c[k] += 1
        if isinstance(fclass, str) and fclass.startswith("category:"): c[fclass] += 1
        if k in ("FP", "FN"):
            misses.append({"index": row.get("_index", i), "kind": k, "taskId": row["taskId"], "group": row["group"], "confidence": conf,
                           "auditReason": b.get("auditReason"), "failureClass": fclass})
    fp, tn, fn, tp = c["FP"], c["TN"], c["FN"], c["TP"]
    return {**dict(c), "FPR": fp / (fp + tn) if fp + tn else None, "FNR": fn / (fn + tp) if fn + tp else None, "misses": misses}

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", required=True); ap.add_argument("--baseline", required=True)
    ap.add_argument("--runs", nargs="*", default=[]); ap.add_argument("--disk", action="store_true", help="also cut the on-disk (baseline raw) verdicts")
    ap.add_argument("--overlay", help="label overlay JSON ({id: {label, rule, ...}}) from owner rulings; overlay labels count as high confidence")
    ap.add_argument("--no-exclusions", action="store_true", help="full-set cut: no environment/unachievable exclusions (errors and unlabeled rows still excluded)")
    ap.add_argument("--out"); a = ap.parse_args()
    global NO_EXCLUSIONS; NO_EXCLUSIONS = a.no_exclusions
    rows = json.load(open(a.manifest)); labels = {r["id"]: dict(r) for r in json.load(open(a.baseline))["rows"]}
    if a.overlay:
        ov = json.load(open(a.overlay)); applied = 0
        for id_, o in ov.items():
            if id_ in labels:
                labels[id_]["label"] = o["label"]; labels[id_]["overlayRule"] = o.get("rule")
                # rulings and two-vote agreements are confirmed (primary); disputed rows are sensitivity-only
                labels[id_]["confidence"] = "medium" if o.get("confidence") == "disputed" else "high"; applied += 1
        print(f"overlay applied to {applied} rows")
    report = {}
    sources = []
    if a.disk:
        sources.append(("disk-gated", lambda i, row, b: (b.get("raw"), "healthy", None) if b.get("raw") is not None else None))
        def disk_judge(i, row, b):
            p = os.path.join(row["run"], "scores", "result.json")
            if not os.path.exists(p): return None
            r = json.load(open(p)); j = r.get("judgeOutcomeSuccess", r.get("outcomeSuccess"))
            return (j, "healthy", None) if isinstance(j, bool) else None
        sources.append(("disk-judge (ungated)", disk_judge))
    for d in a.runs:
        def fn(i, row, b, d=d):
            r = load_result(d, i)
            if r is None: return None
            return r.get("outcomeSuccess"), (r.get("health") or {}).get("status", "healthy"), r.get("failureClass") or (r.get("outcomeCategory") and f"category:{r['outcomeCategory']}")
        sources.append((os.path.basename(d.rstrip("/")), fn))
    # Common row set: a row excluded (environment / unachievable / error / unlabeled) under ANY source is
    # excluded for ALL sources, so every FP/FN column is computed over identical rows.
    common_excluded = set(); why = collections.Counter()
    for name, fn in sources:
        for i, row in enumerate(rows):
            b = labels.get(row["id"]) or {}
            v = fn(i, row, b)
            if v is None: why[(name, "missing")] += 1; common_excluded.add(i); continue
            if v[1] != "healthy": why[(name, "error")] += 1; common_excluded.add(i); continue
            if b.get("label") is None: why[(name, "unlabeled")] += 1; common_excluded.add(i); continue
            out, _, fclass = v
            if a.no_exclusions: continue
            if audit_classification(row, b) == "environment": why[(name, "audit-env")] += 1; common_excluded.add(i)
            elif fclass in ENV_CLASSES and not (b["label"] is False and audit_classification(row, b) == "genuine_fault"): why[(name, "eval-env")] += 1; common_excluded.add(i)
            elif fclass == "goal_unachievable" and b["label"] is not False: why[(name, "eval-unachievable")] += 1; common_excluded.add(i)
    print(f"common comparable rows: {len(rows) - len(common_excluded)} of {len(rows)} (excluded under any source: {len(common_excluded)})")
    if os.environ.get("RECUT_DEBUG"): print("  exclusion reasons:", dict(why))
    report["_common_excluded_rows"] = sorted(common_excluded)
    kept = [{**r, "_index": i} for i, r in enumerate(rows) if i not in common_excluded]
    for name, fn in sources:
        idx = {r["id"]: i for i, r in enumerate(rows)}
        fn_kept = lambda k, row, b, fn=fn: fn(idx[row["id"]], row, b)
        report[name] = {"confirmed-only primary": cut(kept, labels, fn_kept, True), "all-confidence sensitivity": cut(kept, labels, fn_kept, False)}
        p, s = report[name]["confirmed-only primary"], report[name]["all-confidence sensitivity"]
        print(f"{name:28} primary FP/FN {p.get('FP',0)}/{p.get('FN',0)} (TP {p.get('TP',0)} TN {p.get('TN',0)} env-excl {p.get('excluded_environment',0)} unach-excl {p.get('excluded_unachievable',0)} err {p.get('errors',0)}) | "
              f"sensitivity FP/FN {s.get('FP',0)}/{s.get('FN',0)} (TP {s.get('TP',0)} TN {s.get('TN',0)} env-excl {s.get('excluded_environment',0)} err {s.get('errors',0)})")
    if a.out:
        json.dump(report, open(a.out, "w"), indent=1)

if __name__ == "__main__":
    main()
