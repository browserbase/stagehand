#!/usr/bin/env python3
"""Combine luna labels with an independent second vote into confirmed / disputed labels.

  python3 two-vote-overlay.py --votes /tmp/eval-night/second-vote/out --rulings labels-overlay.json --out two-vote-overlay.json

Precedence: owner ruling overlay (mechanical) > two-vote agreement (confidence "two-vote") >
split (confidence "disputed", luna label kept for sensitivity only). Never edits vote files.
"""
import argparse, glob, json, os

def claude_label(v):
    out = v.get("_outcome")
    if out is True and isinstance(v.get("pass_is_wrong"), bool): return not v["pass_is_wrong"]
    if out is False and isinstance(v.get("flip"), bool): return v["flip"]
    return None

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--votes", required=True); ap.add_argument("--rulings"); ap.add_argument("--out", required=True)
    a = ap.parse_args()
    rulings = json.load(open(a.rulings)) if a.rulings else {}
    overlay = {}; stats = {"agree": 0, "split": 0, "ruling": 0, "unparsed": 0}
    splits = []
    for f in glob.glob(os.path.join(a.votes, "*.json")):
        v = json.load(open(f)); id_ = v.get("_id")
        if not id_: continue
        luna = v.get("_luna_label"); cl = claude_label(v)
        if cl is None: stats["unparsed"] += 1; continue
        if id_ in rulings:
            overlay[id_] = {"label": rulings[id_]["label"], "confidence": "ruling", "rule": rulings[id_]["rule"], "luna": luna, "claude": cl}; stats["ruling"] += 1
        elif luna == cl:
            overlay[id_] = {"label": luna, "confidence": "two-vote", "luna": luna, "claude": cl}; stats["agree"] += 1
        else:
            overlay[id_] = {"label": luna, "confidence": "disputed", "luna": luna, "claude": cl, "claudeReason": str(v.get("reason", ""))[:300]}; stats["split"] += 1
            splits.append({"id": id_, "luna": luna, "claude": cl, "lunaConf": v.get("_luna_conf"), "claudeConf": v.get("confidence"), "claudeReason": str(v.get("reason", ""))[:300]})
    json.dump(overlay, open(a.out, "w"), indent=1)
    json.dump(sorted(splits, key=lambda s: s["id"]), open(a.out.replace(".json", "-splits.json"), "w"), indent=1)
    print(stats, "->", a.out)

if __name__ == "__main__":
    main()
