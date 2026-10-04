#!/usr/bin/env python3
"""Blind outcome labels for HardBench rows (v1.2 policy), from an independent grader agent.

  python3 label-blind.py --manifest fresh/dev.json --rubrics rubric-overrides.json --backend codex|claude \
      [--model gpt-5.6-luna|claude-sonnet-5-5] [--jobs 6] --out fresh/labels-<backend>

The grader reads the run directory (trajectory.json, task_data.json, screenshots/) and decides whether
the user's requested outcome was achieved. It is told NOT to open scores/ so no judge verdict can anchor
it. Output per row: {"id","outcome":"pass"|"fail","failure_kind","fallback_applied","confidence",
"deciding_evidence","reason"}. Resumable: rows with an existing output are skipped.
"""
import argparse, json, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

POLICY = """You are grading ONE browser-agent run for a benchmark. Decide whether the user's requested outcome was achieved.
Evidence is on disk in the run directory: trajectory.json (steps[] with actionName/actionArgs/toolOutput/reasoning, finalAnswer, status),
task_data.json, and screenshots/ (probe/<n>.png per step, agent/). Files can be ~1 MB: use python3/grep to load JSON and search
tool outputs for each datum you need; open screenshots only when page text is insufficient. Do not print whole files.
DO NOT open or read anything under scores/ — grade independently. Do not modify any file. Do not browse the web.

Binding policy (HardBench v1.2):
1. Outcome means completion of what the user asked. Honest reporting of a problem earns no outcome credit unless a rule below says so.
2. Correctness: every datum in the final answer the task asks for must be correct per the recorded pages. A datum the pages show
   differently, a value that appears only in the agent's own reasoning and on no page, or a required field/candidate/row that is
   missing makes the outcome FAIL. A correct datum is not failed merely because its source step is hard to find.
3. Table convention: when a table is required, any consistent delimited structure counts (markdown/HTML table, or pipe-,
   semicolon- or comma-separated records with the same fields per record, even on one line). Unstructured prose does not.
   Required columns must still be present.
4. Fallback vs blocker: if the requested item is not offered / out of stock / has no exact match, and the final answer discloses
   this and takes the closest alternative that the RUBRIC's own fallback clause allows, the outcome PASSES (fallback_applied=true).
   The fallback waives only that requirement; every other constraint still binds. If the SITE was inaccessible (bot wall, CAPTCHA,
   error page, login wall, crash), the outcome FAILS with failure_kind "environment".
5. Critical point: reaching a cart, checkout, or booking page with no personal or payment information entered and nothing submitted
   is stopping before the critical point (acceptable). Entering such information or submitting crosses it (FAIL) unless the task asks for it.
   A final answer that claims a purchase/booking was completed when it was not is a false claim (FAIL).
6. Source authority: a value about a retailer/carrier/venue must come from that entity's own page when the run visited it;
   another company's comparison table does not override it.
7. Relative dates resolve against the date shown in the browser during the run; a one-day UTC difference is not an error.
8. Undisclosed substitution (an item missing a requested attribute, presented as the requested item) is a wrong datum (FAIL).
9. A browser disconnect or crash AFTER the requested outcome was already achieved and reported does not undo it (PASS).
10. When the task asks for a single datum (e.g. "which park"), that datum governs the outcome; rubric sub-criteria describe process.
11. Explicit task constraints (dates, guests, nights, sizes, locations, filters, vehicle type) must match the recorded final
    search/selection state (URL parameters, widget values, cart), not merely the agent's narration.

Set confidence "high" only when you can quote the deciding evidence (step number + text, or the task/rubric text).
"""

OUTPUT = """Output ONLY one JSON object on the last line:
{"id": "<id>", "outcome": "pass"|"fail", "failure_kind": "none"|"genuine"|"environment", "fallback_applied": true|false,
 "confidence": "high"|"medium", "deciding_evidence": "<=80 words with step numbers", "reason": "<=60 words"}"""

def prompt_for(row, rubric):
    td = json.load(open(os.path.join(row["run"], "task_data.json")))
    task = td.get("task", td)
    return (POLICY + "\nRUN DIRECTORY: " + row["run"] + "\nID: " + row["id"] + "\nTASK INSTRUCTION:\n" + (task.get("instruction") or task.get("ques") or "")
            + "\n\nRUBRIC (v1.2):\n" + json.dumps(rubric, indent=1, ensure_ascii=False)[:12000] + "\n\n" + OUTPUT)

def run_codex(row, prompt, out, model, log):
    with open(log, "w") as lf:
        subprocess.run(["codex", "exec", "-m", model, "--sandbox", "read-only", "-c", "approval_policy=never", "-C", row["run"], "-o", out, "-"],
                       input=prompt, text=True, stdout=lf, stderr=subprocess.STDOUT, timeout=1200)
    return open(out).read() if os.path.exists(out) else ""

def run_claude(row, prompt, out, model, log):
    env = {k: v for k, v in os.environ.items() if not k.startswith("CLAUDE_CODE") and k != "CLAUDECODE"}
    r = subprocess.run(["claude", "-p", "--model", model, "--output-format", "text", "--add-dir", row["run"],
                        "--allowedTools", "Read,Grep,Glob,Bash(python3:*),Bash(grep:*),Bash(ls:*),Bash(jq:*)"],
                       input=prompt, text=True, capture_output=True, cwd=row["run"], env=env, timeout=1200)
    open(log, "w").write((r.stdout or "") + "\n--- stderr ---\n" + (r.stderr or ""))
    open(out, "w").write(r.stdout or "")
    return r.stdout or ""

def parse(txt, row):
    for line in reversed((txt or "").strip().splitlines()):
        line = line.strip().strip("`")
        if line.startswith("{") and '"outcome"' in line:
            try:
                v = json.loads(line); v["id"] = row["id"]; return v
            except Exception: pass
    m = re.findall(r"\{[^{}]*\"outcome\"[^{}]*\}", txt or "", re.S)
    if m:
        try:
            v = json.loads(m[-1]); v["id"] = row["id"]; return v
        except Exception: pass
    return {"id": row["id"], "error": "unparseable"}

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", required=True); ap.add_argument("--rubrics", required=True); ap.add_argument("--backend", choices=["codex", "claude"], required=True)
    ap.add_argument("--model"); ap.add_argument("--jobs", type=int, default=6); ap.add_argument("--out", required=True)
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    model = a.model or ("gpt-5.6-luna" if a.backend == "codex" else "claude-sonnet-5-5")
    rows = json.load(open(a.manifest)); rubrics = json.load(open(a.rubrics))
    def one(row):
        tag = re.sub(r"[^A-Za-z0-9_.-]", "_", row["id"])[-150:]
        res = os.path.join(a.out, f"{tag}.json")
        if os.path.exists(res):
            v = json.load(open(res))
            if "error" not in v: return v
        out = os.path.join(a.out, f"{tag}.raw.txt"); log = os.path.join(a.out, f"{tag}.log")
        try:
            txt = (run_codex if a.backend == "codex" else run_claude)(row, prompt_for(row, rubrics.get(row["taskId"])), out, model, log)
            v = parse(txt, row)
        except Exception as e:
            v = {"id": row["id"], "error": f"{type(e).__name__}: {e}"}
        v["_model"] = model; v["_backend"] = a.backend
        json.dump(v, open(res, "w"), indent=1)
        print(json.dumps({"id": row["id"][-60:], "outcome": v.get("outcome"), "error": v.get("error")}), flush=True)
        return v
    with ThreadPoolExecutor(a.jobs) as ex: results = list(ex.map(one, rows))
    json.dump(results, open(os.path.join(a.out, "labels.json"), "w"), indent=1)
    ok = [r for r in results if "error" not in r]
    print(f"done: {len(ok)}/{len(results)} labeled; pass={sum(1 for r in ok if r.get('outcome')=='pass')} fail={sum(1 for r in ok if r.get('outcome')=='fail')}")

if __name__ == "__main__":
    main()
