#!/usr/bin/env python3
"""Score replay arms on the fresh corpus against two-grader blind labels, with per-row cost.

  python3 fresh-score.py --manifest fresh/dev.json --labels fresh/labels-codex fresh/labels-claude --runs fresh/arA ... [--exclude-env]

Labels: a row is confirmed when both graders agree (pass/pass or fail/fail); split rows are reported
separately and excluded from the primary table. --exclude-env drops rows either grader marked
failure_kind=environment (the capability view). The on-disk verdict (stack V3 verifier) is scored as
"disk" for the old-judge baseline. Cost: LLM calls/row (checklist calls reported separately and
amortized), tokens/row, median and p90 seconds/row; errors (unhealthy verdicts) are excluded from
FP/FN and counted.
"""
import argparse, glob, json, os, re, statistics as st

def load_labels(dirs):
    out = {}
    for d in dirs:
        for f in glob.glob(os.path.join(d, "*.json")):
            if f.endswith("labels.json"): continue
            v = json.load(open(f))
            if v.get("id") and v.get("outcome") in ("pass", "fail"): out.setdefault(v["id"], {})[v.get("_backend", d)] = v
    return out

def metrics(pairs):
    tp = sum(1 for p, l in pairs if p and l); fp = sum(1 for p, l in pairs if p and not l)
    fn = sum(1 for p, l in pairs if not p and l); tn = sum(1 for p, l in pairs if not p and not l)
    prec = tp / (tp + fp) if tp + fp else 0; rec = tp / (tp + fn) if tp + fn else 0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0; acc = (tp + tn) / len(pairs) if pairs else 0
    fpr = fp / (fp + tn) if fp + tn else 0
    return dict(n=len(pairs), TP=tp, FP=fp, FN=fn, TN=tn, P=round(prec, 3), R=round(rec, 3), F1=round(f1, 3), acc=round(acc, 3), FPR=round(fpr, 3))

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", required=True); ap.add_argument("--labels", nargs="+", required=True); ap.add_argument("--runs", nargs="*", default=[])
    ap.add_argument("--exclude-env", action="store_true"); ap.add_argument("--out")
    a = ap.parse_args()
    rows = json.load(open(a.manifest)); labels = load_labels(a.labels)
    confirmed = {}; split = 0; env = 0; missing = 0
    for r in rows:
        votes = labels.get(r["id"], {})
        if len(votes) < 2: missing += 1; continue
        outs = {v["outcome"] for v in votes.values()}
        if len(outs) > 1: split += 1; continue
        if a.exclude_env and any(v.get("failure_kind") == "environment" for v in votes.values()): env += 1; continue
        confirmed[r["id"]] = outs.pop() == "pass"
    print(f"rows {len(rows)} | confirmed {len(confirmed)} (pass {sum(confirmed.values())}, fail {len(confirmed)-sum(confirmed.values())}) | split {split} | env-excluded {env} | unlabeled {missing}")
    report = {}
    disk = [(bool(json.load(open(os.path.join(r["run"], "scores/result.json"))).get("outcomeSuccess")), confirmed[r["id"]]) for r in rows if r["id"] in confirmed]
    report["disk (stack V3)"] = {**metrics(disk)}
    for run in a.runs:
        pairs = []; calls = []; req = 0; toks = []; secs = []; err = 0
        for i, r in enumerate(rows):
            p = os.path.join(run, f"{i}.json")
            if not os.path.exists(p): continue
            rec = json.load(open(p)); res = rec.get("result") or {}
            tp = os.path.join(run, f"{i}.trace.jsonl"); stages = []
            if os.path.exists(tp):
                for line in open(tp):
                    o = json.loads(line)
                    if o.get("message") == "verifier request":
                        v = (o.get("auxiliary") or {}).get("request", {}).get("value") or {}
                        stages.append(v.get("stage") if isinstance(v, dict) else None)
                    if "requirement checklist" in str(o.get("message", "")): pass
            u = rec.get("usage") or []
            n_req = sum(1 for s in stages if s == "RequirementChecklist") if stages else 0
            # Judge calls = traced verifier requests (health checks are not traced), minus checklist calls.
            calls.append((len(stages) if stages else len(u)) - n_req); req += n_req
            toks.append(sum(((c or {}).get("inputTokens") or 0) + ((c or {}).get("outputTokens") or 0) for c in u))
            secs.append((rec.get("durationMs") or 0) / 1000)
            if rec.get("error") or ((res.get("health") or {}).get("status") not in (None, "healthy")): err += 1; continue
            if r["id"] in confirmed: pairs.append((bool(res.get("outcomeSuccess")), confirmed[r["id"]]))
        name = os.path.basename(run.rstrip("/"))
        report[name] = {**metrics(pairs), "err": err, "calls/row": round(st.mean(calls), 2) if calls else None, "checklist calls": req,
                        "tokens/row": int(st.mean(toks)) if toks else None, "median s": round(st.median(secs), 1) if secs else None,
                        "p90 s": round(sorted(secs)[max(0, int(.9 * len(secs)) - 1)], 1) if secs else None}
    for k, v in report.items(): print(f"{k:24} " + " ".join(f"{kk}={vv}" for kk, vv in v.items()))
    if a.out: json.dump(report, open(a.out, "w"), indent=1)

if __name__ == "__main__":
    main()
