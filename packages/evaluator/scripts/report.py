"""Compare raw replay judgments with both ungated and gated saved verdicts."""
import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path


def table(rows, predictions, confirmed):
    counts = Counter(TP=0, TN=0, FP=0, FN=0, excluded=0, errors=0)
    for row in rows:
        if not isinstance(row.get('label'), bool) or (confirmed and row.get('confidence') != 'high'):
            counts['excluded'] += 1
            continue
        prediction = predictions.get(row['id'])
        if not isinstance(prediction, bool):
            counts['errors'] += 1
            continue
        counts[('T' if prediction == row['label'] else 'F') + ('P' if prediction else 'N')] += 1
    return {**counts, 'FPR': counts['FP'] / (counts['FP'] + counts['TN']) if counts['FP'] + counts['TN'] else None,
            'FNR': counts['FN'] / (counts['FN'] + counts['TP']) if counts['FN'] + counts['TP'] else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--runs', type=Path, nargs='+', required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    baseline = {r['id']: r for r in json.loads(args.baseline.read_text())['rows']}
    rows = [{**baseline.get(r['id'], {}), **r} for r in manifest]
    predictions = {'disk gated production outcome': {}, 'disk ungated judge': {}}
    details, stamps, run_health = {}, {}, {}
    for row in rows:
        score_path = Path(row['run']) / 'scores/result.json'
        score_bytes = score_path.read_bytes()
        assert hashlib.sha256(score_bytes).hexdigest() == row['files']['scores/result.json'], row['id']
        score = json.loads(score_bytes)
        predictions['disk gated production outcome'][row['id']] = score['outcomeSuccess']
        # If an older score has no gate metadata, the saved outcome is the judge's verdict.
        judge = score.get('judgeOutcomeSuccess', score.get('judge', {}).get('outcomeSuccess'))
        if judge is None and not score.get('outcomeGates'):
            judge = score['outcomeSuccess']
        predictions['disk ungated judge'][row['id']] = judge
    for run in args.runs:
        stamps[run.name] = json.loads((run / 'run.json').read_text())
        assert stamps[run.name]['manifestSha256'] == hashlib.sha256(args.manifest.read_bytes()).hexdigest()
        predictions[run.name] = {}
        details[run.name] = {}
        run_health[run.name] = Counter()
        for i, row in enumerate(rows):
            record = json.loads((run / f'{i}.json').read_text())
            assert record['id'] == row['id']
            result = record.get('result', {})
            health = result.get('health', {})
            error = record.get('error') or (health and health.get('status') != 'healthy')
            run_health[run.name]['thrown' if record.get('error') else health.get('status', 'unreported')] += 1
            predictions[run.name][row['id']] = None if error else result.get('outcomeSuccess')
            details[run.name][row['id']] = {'state': result.get('outcomeState'), 'health': health,
                'error': record.get('error'), 'reasoning': result.get('rawSteps', {}).get('reasoning')}
    tables = {title: {name: table(rows, values, confirmed) for name, values in predictions.items()}
              for title, confirmed in [('confirmed-only primary', True), ('all-confidence sensitivity', False)]}
    cells = {group: {title: {name: table([r for r in rows if r['group'] == group], values, confirmed)
                            for name, values in predictions.items()}
                    for title, confirmed in [('confirmed-only primary', True), ('all-confidence sensitivity', False)]}
             for group in sorted({r['group'] for r in rows})}
    disagreements = []
    for i, row in enumerate(rows):
        values = {name: preds[row['id']] for name, preds in predictions.items()}
        disagreements.append({'index': i, 'id': row['id'], 'taskId': row['taskId'],
            'label': row.get('label'), 'confidence': row.get('confidence'),
            'auditReason': row.get('auditReason'), 'predictions': values,
            'replays': {name: data[row['id']] for name, data in details.items()}})
    flips, variance = {}, {}
    for a, b in zip(args.runs, args.runs[1:]):
        flips[f'{a.name} -> {b.name}'] = [r['id'] for r in rows
            if isinstance(predictions[a.name][r['id']], bool) and isinstance(predictions[b.name][r['id']], bool)
            and predictions[a.name][r['id']] != predictions[b.name][r['id']]]
        comparable = [r for r in rows if isinstance(predictions[a.name][r['id']], bool)
                      and isinstance(predictions[b.name][r['id']], bool)]
        labeled = [r for r in comparable if isinstance(r.get('label'), bool)]
        changed = set(flips[f'{a.name} -> {b.name}'])
        variance[f'{a.name} -> {b.name}'] = {
            'sameModel': stamps[a.name]['model'] == stamps[b.name]['model'],
            'sameBuild': (stamps[a.name]['buildSha256'] == stamps[b.name]['buildSha256'])
                if stamps[a.name].get('buildSha256') and stamps[b.name].get('buildSha256') else None,
            'sameConfig': stamps[a.name].get('config') == stamps[b.name].get('config'),
            'comparableRows': len(comparable), 'flippedRows': len(changed),
            'labeledComparableRows': len(labeled), 'labeledFlippedRows': sum(r['id'] in changed for r in labeled),
            'rowsWithErrorInEitherRun': len(rows) - len(comparable)}
    with args.out.open('x') as output:
        json.dump({'tables': tables, 'cells': cells, 'runStamps': stamps, 'perRow': disagreements,
                   'pairwiseFlips': flips, 'variance': variance, 'runHealth': run_health}, output, indent=2)
    print(json.dumps(tables, indent=2))


if __name__ == '__main__':
    main()
