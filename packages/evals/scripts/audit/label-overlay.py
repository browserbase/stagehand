#!/usr/bin/env python3
"""Label overlay from owner rulings — explicit adjudications only, plus a candidate list for review.

  python3 label-overlay.py --baseline baseline.json --manifests ... --votes /tmp/eval-night/second-vote/out \
      --adjudications label-adjudications.json --out overlay.json [--candidates candidates.json]

Rules (2026-09-05/06):
  * Applied automatically ONLY when explicitly adjudicated: `--adjudications` lists row ids with the
    evidence hashes seen at adjudication time and the ruling label. A hash mismatch skips the row.
  * table-rule candidates (owner ruling: any consistent delimited structure is a table, prose is not):
    luna FAIL whose reason is format-only AND whose answer classifies as delimited AND whose second
    vote (claude) PASSED — written to `--candidates` for review, and applied only if the id is also
    adjudicated. Nothing is flipped on regex evidence alone.
Never edits luna verdict files.
"""
import argparse, glob, hashlib, json, os, re

FORMAT = re.compile(r"\btable\b|tabular|pipe-|delimited|prose|format", re.I)
OTHER = re.compile(r"omit|missing (candidate|product|field|row|url|source|column)|url|source url|column|only (one|two|three|names|the)|did not compare|not compare|wrong (datum|price|store|year|date|direction)|fabricat|incorrect|contradict|not (shown|established|applied|set)|violat|undisclosed|substitut|checkout|purchase|session|cut off|prevent|before the", re.I)
URL_RE = re.compile(r"https?://\S+")

def unwrap(ans):
    a = (ans or "").strip()
    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", a, re.S) or re.match(r"^(\{.*\})$", a, re.S)
    if m:
        try:
            obj = json.loads(m.group(1)); inner = obj.get("finalAnswer") or obj.get("answer") or obj.get("result")
            if isinstance(inner, str) and inner.strip(): return inner
        except Exception: pass
    return a

def consistent(ns, tol=1): return bool(ns) and max(ns) - min(ns) <= tol

def structure(ans):
    """Mirror of packages/evaluator/src/answerStructure.ts."""
    raw = unwrap(ans)
    if not raw.strip(): return "empty"
    a = URL_RE.sub("URL", raw); lines = [l for l in a.splitlines() if l.strip()]
    if re.search(r"<table[\s>]", a, re.I) and re.search(r"<tr[\s>]", a, re.I): return "html-table"
    if re.search(r"^\s*\|?[\s:-]+\|[\s:|-]+$", a, re.M): return "markdown-table"
    pipe = [l.count("|") for l in lines if l.count("|") >= 1]
    if len(pipe) >= 2 and consistent(pipe): return "multiline-pipe-rows"
    comma = [l for l in lines if l.count(",") >= 1 and len(l) <= 240 and not re.search(r"[.!?]\s*$", l.strip())]
    if len(lines) >= 3 and len(comma) == len(lines) and consistent([l.count(",") for l in comma], 0): return "csv-rows"
    if len(lines) <= 2 and a.count("|") >= 4: return "inline-delimited"
    if len(lines) <= 2 and a.count(";") >= 1:
        recs = [r.strip() for r in re.sub(r"\([^)]*\)", "", a).split(";") if r.strip()]
        fields = [max(r.count(":"), r.count(","), r.count(" = "), len(re.findall(r"\$\d", r))) for r in recs]
        if len(recs) >= 2 and min(fields) >= 1 and consistent(fields, 1): return "inline-delimited"
    return "prose"

def file_hashes(run):
    out = {}
    for f in ("trajectory.json", "scores/result.json", "task_data.json"):
        p = os.path.join(run, f)
        if os.path.exists(p): out[f] = hashlib.sha256(open(p, "rb").read()).hexdigest()
    return out

def claude_votes(votes_dir):
    v = {}
    for f in glob.glob(os.path.join(votes_dir or "", "*.json")):
        o = json.load(open(f)); id_ = o.get("_id")
        if not id_: continue
        out = o.get("_outcome")
        if out is True and isinstance(o.get("pass_is_wrong"), bool): v[id_] = not o["pass_is_wrong"]
        elif out is False and isinstance(o.get("flip"), bool): v[id_] = o["flip"]
    return v

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--baseline", required=True); ap.add_argument("--manifests", nargs="+", required=True)
    ap.add_argument("--votes"); ap.add_argument("--adjudications"); ap.add_argument("--out", required=True); ap.add_argument("--candidates")
    a = ap.parse_args()
    labels = {r["id"]: r for r in json.load(open(a.baseline))["rows"]}
    adj = json.load(open(a.adjudications)) if a.adjudications else {}
    claude = claude_votes(a.votes) if a.votes else {}
    overlay, candidates, skipped = {}, {}, []
    seen = set()
    for m in a.manifests:
        for row in json.load(open(m)):
            b = labels.get(row["id"])
            if not b or b.get("label") is None or row["id"] in seen: continue
            seen.add(row["id"])
            if row["id"] in adj:
                want = adj[row["id"]].get("hashes") or {}
                have = file_hashes(row["run"])
                if all(have.get(k) == v for k, v in want.items()):
                    overlay[row["id"]] = {"label": adj[row["id"]]["label"], "was": b["label"], "confidence": "ruling", "rule": adj[row["id"]]["rule"], "adjudicated": True}
                else:
                    skipped.append(row["id"])
                continue
            reason = str(b.get("auditReason", ""))
            if b["label"] is False and FORMAT.search(reason) and not OTHER.search(reason):
                try: ans = json.load(open(os.path.join(row["run"], "task_data.json"))).get("finalAnswer") or ""
                except Exception: ans = ""
                s = structure(ans)
                if s not in ("prose", "empty") and claude.get(row["id"]) is True:
                    candidates[row["id"]] = {"proposed": True, "was": False, "rule": "table-rule:delimited-is-table", "structure": s, "claude": True, "auditReason": reason[:200], "hashes": file_hashes(row["run"])}
    json.dump(overlay, open(a.out, "w"), indent=1)
    if a.candidates: json.dump(candidates, open(a.candidates, "w"), indent=1)
    print(f"overlay applied: {len(overlay)} adjudicated rows; hash-mismatch skipped: {len(skipped)}; table-rule candidates for review: {len(candidates)}")

if __name__ == "__main__":
    main()
