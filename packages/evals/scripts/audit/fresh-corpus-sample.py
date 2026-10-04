#!/usr/bin/env python3
"""Sample a fresh, stratified evaluation corpus from a trajectory store, split by task ID.

  python3 fresh-corpus-sample.py --store <.trajectories> --rubrics rubric-overrides.json --n 240 --dev-frac 0.35 --out fresh/

Population: runs of tasks covered by --rubrics, with a boolean on-disk verdict and ≥1 step.
Strata: model (capped share) × on-disk verdict (balanced). Split: sha1(taskId) → dev if < dev-frac,
so every run of a task lands on one side. Deterministic (seeded). Writes dev.json / test.json manifests
in the replay format ({id, group, taskId, run, files}) plus sample-meta.json.
"""
import argparse, collections, glob, hashlib, json, os, random

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--store", required=True); ap.add_argument("--rubrics", required=True); ap.add_argument("--n", type=int, default=240)
    ap.add_argument("--dev-frac", type=float, default=0.35); ap.add_argument("--max-model-share", type=float, default=0.12)
    ap.add_argument("--seed", type=int, default=20260929); ap.add_argument("--out", required=True)
    a = ap.parse_args(); rng = random.Random(a.seed)
    tasks = set(json.load(open(a.rubrics)))
    pop = []
    for res in glob.glob(f"{a.store}/agent_hardbenchmark__*/*/*/scores/result.json"):
        run = os.path.dirname(os.path.dirname(res)); task = os.path.basename(os.path.dirname(run)); group = os.path.basename(os.path.dirname(os.path.dirname(run)))
        if task not in tasks or not os.path.exists(f"{run}/trajectory.json"): continue
        try:
            v = json.load(open(res)).get("outcomeSuccess"); steps = len(json.load(open(f"{run}/trajectory.json")).get("steps") or [])
        except Exception: continue
        if not isinstance(v, bool) or steps == 0: continue
        model = group.replace("agent_hardbenchmark__", "").rsplit("__", 1)[0]
        pop.append({"id": f"{group}/{task}/{os.path.basename(run)}", "group": group, "taskId": task, "run": run, "model": model, "disk": v})
    rng.shuffle(pop)
    # Fill each on-disk verdict side separately so both classes are well represented; within a side,
    # cap per model and per task so no single harness/model or task dominates.
    cap = max(1, int(a.n * a.max_model_share)); per_model = collections.Counter(); per_task = collections.Counter(); chosen = []
    for side in (False, True):
        want = a.n // 2
        got = 0
        for r in pop:
            if got >= want: break
            if r["disk"] is not side or r in chosen: continue
            if per_model[r["model"]] >= cap or per_task[r["taskId"]] >= 5: continue
            chosen.append(r); per_model[r["model"]] += 1; per_task[r["taskId"]] += 1; got += 1
    per_verdict = collections.Counter(r["disk"] for r in chosen)
    dev, test = [], []
    for r in chosen:
        r["files"] = {f: hashlib.sha256(open(os.path.join(r["run"], f), "rb").read()).hexdigest() for f in ("trajectory.json", "scores/result.json", "task_data.json") if os.path.exists(os.path.join(r["run"], f))}
        (dev if int(hashlib.sha1(r["taskId"].encode()).hexdigest(), 16) % 1000 < a.dev_frac * 1000 else test).append(r)
    os.makedirs(a.out, exist_ok=True)
    json.dump(dev, open(f"{a.out}/dev.json", "w"), indent=1); json.dump(test, open(f"{a.out}/test.json", "w"), indent=1)
    meta = {"population": len(pop), "chosen": len(chosen), "dev": len(dev), "test": len(test), "devTasks": len({r['taskId'] for r in dev}), "testTasks": len({r['taskId'] for r in test}),
            "models": dict(per_model), "diskVerdicts": {str(k): v for k, v in per_verdict.items()}, "seed": a.seed}
    json.dump(meta, open(f"{a.out}/sample-meta.json", "w"), indent=1); print(json.dumps(meta, indent=1))

if __name__ == "__main__":
    main()
