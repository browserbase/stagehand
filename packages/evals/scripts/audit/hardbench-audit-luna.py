#!/usr/bin/env python3
"""HardBenchmark verdict audit on gpt-5.6-luna via `codex exec` (one call per row).

  python3 packages/evals/scripts/audit/hardbench-audit-luna.py <trajectory-group-dir> [--model gpt-5.6-luna] [--jobs 8] [--out /tmp/hb-audit-<label>]

For every graded run in the group it writes a spec (task, rubric, judge verdict,
final answer, run dir) with the owner's grading policy, runs codex read-only
against the worktree, and tallies: corrected = raw - FP(high) + FN(high).
Policy rulings (2026-09-02): correctness over sourcing; filter/sort state
satisfies grouping; fabricated checkout data fails only if task/rubric says
stop; undisclosed substitution = wrong datum. A flip counts at confidence
"high" only; medium flips are reported separately as disputed.
"""
import argparse, glob, json, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

POLICY = """You are auditing ONE browser-agent eval row. Evidence is on disk in the run directory below: trajectory.json (steps[] with actionName/actionArgs/toolOutput/reasoning, finalAnswer, status), scores/result.json (judge verdict per criterion), task_data.json (task + rubric). Files can be ~1 MB: use python3/grep to load JSON and search step toolOutputs for the datum each criterion needs. Do not print whole files. Do not modify any file.

Binding grading policy:
1. Correctness over sourcing. A factually correct datum passes its criterion even if the trajectory does not show where it was read. Only a WRONG datum, a missing deliverable, or a contradiction with what the pages showed makes a pass wrong. "Unverified claim" alone is not grounds.
2. Filter or sort state on the site satisfies a grouping constraint when the site offers no discrete group.
3. Critical point: fabricated personal/payment data at checkout fails the outcome ONLY if the task instruction or a rubric criterion says to stop before it; quote it. Otherwise acceptable.
4. Substitution: an item missing a required attribute, presented as the requested item without disclosure, is a wrong datum. A disclosed substitution with its reason is graded on the rubric's fallback clause.
5. Environment problems (browser never started, session lost, provider rate limit or disconnect, bot-wall) are not agent faults.

Set confidence "high" only when you quote the deciding evidence (step number + text, or the task/rubric text for rule 3); otherwise "medium".
"""

PASS_TASK = """This row PASSED. Decide whether the pass is wrong under the policy.
Output ONLY a JSON object on the last line: {"id": "...", "pass_is_wrong": true|false, "confidence": "high"|"medium", "rule_applied": "1|2|3|4|5|none", "reason": "<=60 words", "evidence": "<=80 words with step numbers"}
"""
FAIL_TASK = """This row FAILED. Classify it (genuine_fault | environment | verifier_false_negative | task_invalid). Set flip=true only if EVERY rubric criterion is satisfied in the trajectory (quote each datum's step) and the outcome should have passed.
Output ONLY a JSON object on the last line: {"id": "...", "classification": "...", "flip": true|false, "confidence": "high"|"medium", "reason": "<=60 words", "evidence": "<=80 words with step numbers"}
"""

def rows_from_group(group):
    out = []
    for tj in sorted(glob.glob(os.path.join(group, "*", "*", "trajectory.json"))):
        d = os.path.dirname(tj); rp = os.path.join(d, "scores", "result.json"); td = os.path.join(d, "task_data.json")
        if not os.path.exists(rp): continue
        t = json.load(open(tj)); r = json.load(open(rp)); task = json.load(open(td)) if os.path.exists(td) else {}
        crit = [{"c": c.get("criterion", "")[:160], "e": c.get("earnedPoints"), "m": c.get("maxPoints"), "x": (c.get("explanation") or "")[:240]} for c in r.get("perCriterion", [])]
        out.append({"id": os.path.basename(os.path.dirname(d)) + "/" + os.path.basename(d), "run": os.path.abspath(d),
                    "instruction": (task.get("ques") or task.get("instruction") or "")[:800], "finalAnswer": (t.get("finalAnswer") or "")[:500],
                    "status": t.get("status"), "steps": len(t.get("steps", [])), "criteria": crit, "outcome": bool(r.get("outcomeSuccess"))})
    return out

def run_one(row, outdir, model, workdir):
    label = re.sub(r"[^A-Za-z0-9_.-]", "_", row["id"])
    spec = os.path.join(outdir, f"spec-{label}.md"); out = os.path.join(outdir, f"out-{label}.md")
    body = POLICY + "\n" + (PASS_TASK if row["outcome"] else FAIL_TASK) + "\nROW:\n" + json.dumps(row, indent=1)
    open(spec, "w").write(body)
    with open(spec) as fin, open(os.path.join(outdir, f"log-{label}.txt"), "w") as log:
        subprocess.run(["codex", "exec", "-m", model, "--sandbox", "read-only", "-c", "approval_policy=never", "-C", workdir, "-o", out, "-"], stdin=fin, stdout=log, stderr=subprocess.STDOUT)
    try:
        txt = open(out).read().strip().splitlines()
        verdict = json.loads(next(l for l in reversed(txt) if l.strip().startswith("{")))
    except Exception as e:
        verdict = {"id": row["id"], "error": f"unparseable: {e}"}
    verdict["_outcome"] = row["outcome"]
    return verdict

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("group"); ap.add_argument("--model", default="gpt-5.6-luna"); ap.add_argument("--jobs", type=int, default=8); ap.add_argument("--out"); ap.add_argument("--workdir", default=os.getcwd())
    ap.add_argument("--only-runs", help="JSON file: list of absolute run dirs to audit (second-vote subsets); other runs in the group are skipped")
    a = ap.parse_args(); rows = rows_from_group(a.group)
    if a.only_runs:
        keep = {os.path.abspath(p) for p in json.load(open(a.only_runs))}
        rows = [r for r in rows if os.path.abspath(r["run"]) in keep]
        print(f"second-vote subset: {len(rows)} rows", file=sys.stderr)
    outdir = a.out or f"/tmp/hb-audit-{os.path.basename(a.group.rstrip('/'))[-16:]}"; os.makedirs(outdir, exist_ok=True)
    with ThreadPoolExecutor(a.jobs) as ex: verdicts = list(ex.map(lambda r: run_one(r, outdir, a.model, a.workdir), rows))
    json.dump(verdicts, open(os.path.join(outdir, "verdicts.json"), "w"), indent=1)
    raw = sum(1 for v in verdicts if v["_outcome"]); n = len(verdicts)
    fp_hi = [v for v in verdicts if v["_outcome"] and v.get("pass_is_wrong") and v.get("confidence") == "high"]
    fp_md = [v for v in verdicts if v["_outcome"] and v.get("pass_is_wrong") and v.get("confidence") != "high"]
    fn_hi = [v for v in verdicts if not v["_outcome"] and v.get("flip") and v.get("confidence") == "high"]
    fn_md = [v for v in verdicts if not v["_outcome"] and v.get("flip") and v.get("confidence") != "high"]
    env = sum(1 for v in verdicts if not v["_outcome"] and v.get("classification") == "environment")
    gen = sum(1 for v in verdicts if not v["_outcome"] and v.get("classification") == "genuine_fault")
    errs = sum(1 for v in verdicts if "error" in v)
    corr = raw - len(fp_hi) + len(fn_hi)
    print(f"rows {n} raw {raw} | FP high {len(fp_hi)} (disputed medium {len(fp_md)}) | FN high {len(fn_hi)} (disputed medium {len(fn_md)}) | genuine {gen} env {env} | unparseable {errs}")
    print(f"corrected {corr}/{n} = {corr/n:.0%}   (verdicts: {outdir}/verdicts.json)")

if __name__ == "__main__": main()
