#!/usr/bin/env python3
"""Apply the v1.2 rubric conventions to existing pass labels so ground truth matches the rubric text.

  python3 v12-relabel.py --baseline baseline.json --overlay two-vote-overlay.json --overrides rubric-overrides-v1.2.json \
      --manifests ... --runs take8-dev-pass1 take8-heldout-pass1 ... --adjudications label-adjudications.json

Two mechanical conventions, both requiring independent corroboration (never the evaluator alone):
  table-format : label PASS, the v1.2 rubric has a table-format criterion, and the saved final answer
                 classifies as prose  -> FAIL (convention: prose is not a table).
  blocker      : label PASS, the evaluator classified the run as environment (site_blocked /
                 browser_session_lost / environment_blocked) AND an audit reason (luna or claude) also
                 cites a blocker -> FAIL, category environment (convention: outcome not complete).
Writes hash-checked adjudications; prints every change for review.
"""
import argparse, glob, hashlib, json, os, re, importlib.util

BLOCKER = re.compile(r"blocked|blocker|access denied|captcha|bot|error page|something went wrong|crash|session (was )?lost|login wall|inaccessib|froze|loading", re.I)

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--baseline", required=True); ap.add_argument("--overlay", required=True); ap.add_argument("--overrides", required=True)
    ap.add_argument("--manifests", nargs="+", required=True); ap.add_argument("--runs", nargs="+", required=True)
    ap.add_argument("--adjudications", required=True); ap.add_argument("--votes", default="/tmp/eval-night/second-vote/out")
    a = ap.parse_args()
    spec = importlib.util.spec_from_file_location("ov", os.path.join(os.path.dirname(__file__), "label-overlay.py")); ov = importlib.util.module_from_spec(spec); spec.loader.exec_module(ov)
    labels = {r["id"]: r for r in json.load(open(a.baseline))["rows"]}; overlay = json.load(open(a.overlay)); rubrics = json.load(open(a.overrides))
    adj = json.load(open(a.adjudications))
    claude = {}
    for f in glob.glob(os.path.join(a.votes, "*.json")):
        v = json.load(open(f)); claude[v.get("_id")] = str(v.get("reason", ""))
    changes = []
    for m, run in zip(a.manifests, a.runs):
        rows = json.load(open(m))
        for i, row in enumerate(rows):
            id_ = row["id"]; b = labels.get(id_, {}); cur = overlay.get(id_, {}).get("label", b.get("label"))
            # Never overwrite an owner adjudication; only touch rows whose current label rests on grader agreement.
            if cur is not True or id_ in adj: continue
            rub = rubrics.get(row["taskId"], {}); needs_table = any(re.search(r"\btable\b|tabular", it.get("criterion", "") + " " + it.get("description", ""), re.I) for it in rub.get("items", []))
            try: ans = json.load(open(os.path.join(row["run"], "task_data.json"))).get("finalAnswer") or ""
            except Exception: ans = ""
            res = json.load(open(os.path.join(run, f"{i}.json"))).get("result") or {}
            fc = res.get("failureClass"); ga = ((res.get("outcomeChecks") or {}).get("goal_achievability") or {}).get("state")
            reasons = str(b.get("auditReason", "")) + " " + claude.get(id_, "")
            rule = None
            if needs_table and ov.structure(ans) in ("prose", "empty"):
                rule = ("v1.2 table-format convention: rubric requires a table; saved answer is prose", False, None)
            elif (fc == "site_blocked" or ga == "environment_blocked") and BLOCKER.search(reasons) and res.get("outcomeSuccess") is False:
                # Never on browser_session_lost alone, and never when the judge itself passed the row: a
                # session dropped after a proven completion is the owner's disconnect ruling (PASS), not a blocker.
                rule = ("v1.2 blocker convention: site blocker (bot wall / error page / login wall) corroborated by audit reason and the judge; outcome not complete, excluded from capability", False, "environment")
            if rule:
                h = {f: hashlib.sha256(open(os.path.join(row["run"], f), "rb").read()).hexdigest() for f in ("trajectory.json", "scores/result.json", "task_data.json")}
                adj[id_] = {"label": rule[1], "rule": rule[0], "hashes": h, "adjudicatedBy": "v1.2-convention", "date": "2026-09-06", **({"category": rule[2]} if rule[2] else {})}
                changes.append((os.path.basename(m), i, row["taskId"][:18], rule[0].split(":")[0]))
    json.dump(adj, open(a.adjudications, "w"), indent=1)
    for c in changes: print("  relabel PASS->FAIL", *c)
    print(f"{len(changes)} rows relabeled under v1.2 conventions; adjudications now {len(adj)}")

if __name__ == "__main__":
    main()
