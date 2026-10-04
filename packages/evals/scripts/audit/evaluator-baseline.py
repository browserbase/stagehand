"""Freeze saved verifier/audit comparisons without invoking a model or editing runs."""
import argparse
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def label(verdict):
    raw = verdict.get('_outcome')
    if raw is True and isinstance(verdict.get('pass_is_wrong'), bool):
        return not verdict['pass_is_wrong']
    if raw is False and isinstance(verdict.get('flip'), bool):
        return verdict['flip']
    return None


def compare(rows, confirmed):
    counts = Counter()
    for row in rows:
        if row.get('label') is None or (confirmed and row.get('confidence') != 'high'):
            counts['unlabeled_or_disputed'] += 1
            continue
        counts[('T' if row['raw'] == row['label'] else 'F') + ('P' if row['raw'] else 'N')] += 1
    fp, tn, fn, tp = (counts[k] for k in ('FP', 'TN', 'FN', 'TP'))
    return {**dict(counts), 'FPR': fp / (fp + tn) if fp + tn else None,
            'FNR': fn / (fn + tp) if fn + tp else None, 'rows': len(rows)}


def split(rows, development):
    task_ids = {row['taskId'] for row in development}
    heldout = [row for row in rows if row['taskId'] not in task_ids]
    assert not task_ids.intersection(row['taskId'] for row in heldout)
    return heldout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--audits', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    roots = [args.workspace / name / '.trajectories' for name in
             ['stagehand-wt-facade-batch', 'stagehand-wt-claude-cua', 'stagehand-wt-openai-responses']]
    groups = {p.name: p for root in roots for p in sorted(root.glob('agent_hardbenchmark__*'))}
    rows, issues = [], []
    audited = set()
    for audit in sorted(args.audits.glob('*/verdicts.json')):
        group = groups.get(audit.parent.name)
        if group is None:
            continue  # Aliased audit directories need explicit provenance; never guess.
        verdicts = json.loads(audit.read_text())
        if not isinstance(verdicts, list):
            continue
        by_id = defaultdict(list)
        for verdict in verdicts:
            by_id[verdict.get('id', '')].append(verdict)
        for score in sorted(group.glob('*/*/scores/result.json')):
            run = score.parent.parent
            task_id = run.parent.name
            candidates = by_id.get(task_id + '/' + run.name) or by_id.get(task_id) or []
            if len(candidates) != 1 or (len(list((group/task_id).iterdir())) > 1 and '/' not in candidates[0]['id']):
                issues.append({'run': str(run), 'issue': 'missing-or-ambiguous-label'})
                verdict = {}
            else:
                verdict = candidates[0]
            raw = json.loads(score.read_text()).get('outcomeSuccess')
            if not isinstance(raw, bool):
                issues.append({'run': str(run), 'issue': 'non-boolean-score'})
                continue
            if verdict and verdict.get('_outcome') != raw:
                issues.append({'run': str(run), 'issue': 'audit-baseline-mismatch'})
                verdict = {}
            files = {name: digest(run/name) for name in
                     ['trajectory.json', 'scores/result.json', 'task_data.json', 'metadata.json'] if (run/name).exists()}
            rows.append({'id': group.name + '/' + task_id + '/' + run.name,
                         'group': group.name, 'taskId': task_id, 'run': str(run), 'raw': raw,
                         'label': label(verdict), 'confidence': verdict.get('confidence'),
                         'audit': str(audit), 'auditSha256': digest(audit), 'files': files,
                         'auditReason': verdict.get('reason'), 'auditEvidence': verdict.get('evidence')})
        audited.add(group.name)
    # Preserve clean reference cells even where only aggregate audit results remain.
    for name, group in groups.items():
        if name in audited or not any(s in name for s in ['fable-5-1__20260902-112444', 'gpt-5.6-sol__20260902-093026']):
            continue
        for score in sorted(group.glob('*/*/scores/result.json')):
            run = score.parent.parent
            rows.append({'id': name+'/'+run.parent.name+'/'+run.name, 'group': name,
                         'taskId': run.parent.name, 'run': str(run),
                         'raw': json.loads(score.read_text())['outcomeSuccess'], 'label': None,
                         'confidence': None, 'files': {n: digest(run/n) for n in
                         ['trajectory.json', 'scores/result.json', 'task_data.json', 'metadata.json'] if (run/n).exists()}})
    args.out.mkdir(parents=True, exist_ok=False)
    tables = {'confirmed-only primary': compare(rows, True), 'all-confidence sensitivity': compare(rows, False)}
    cells = {g: {title: compare([r for r in rows if r['group'] == g], confirmed)
                  for title, confirmed in [('confirmed-only primary', True), ('all-confidence sensitivity', False)]}
             for g in sorted({r['group'] for r in rows})}
    (args.out/'baseline.json').write_text(json.dumps({'tables': tables, 'cells': cells, 'rows': rows, 'issues': issues}, indent=2)+'\n')
    # Compatibility inventory records provenance without rejudging.
    compatibility = []
    for bench in ['agent_webtailbench', 'agent_odysseysbench']:
        counts = Counter()
        for trajectory in sorted((args.workspace/'bb-agent-evals/.trajectories'/bench).glob('*/*/trajectory.json')):
            data = json.loads(trajectory.read_text())
            mode = 'precomputed' if data.get('task', {}).get('precomputedRubric') else 'generated-needed'
            if counts[mode] >= 3:
                continue
            counts[mode] += 1
            compatibility.append({'benchmark': bench, 'run': str(trajectory.parent), 'rubricMode': mode,
                                  'trajectorySha256': digest(trajectory)})
    (args.out/'compatibility.json').write_text(json.dumps(compatibility, indent=2)+'\n')
    print(json.dumps({'tables': tables, 'groups': len(cells), 'issues': len(issues), 'compatibility': compatibility}, indent=2))


if __name__ == '__main__':
    main()
