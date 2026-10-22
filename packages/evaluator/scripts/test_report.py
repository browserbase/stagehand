"""Run with: python3 -m unittest packages/evaluator/scripts/test_report.py"""
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import report  # noqa: E402


class TableTest(unittest.TestCase):
    def test_classifies_and_excludes_failed_or_unlabeled_rows(self):
        rows = [{'id': 'tp', 'label': True, 'confidence': 'high'},
                {'id': 'fp', 'label': False, 'confidence': 'high'},
                {'id': 'fn', 'label': True, 'confidence': 'high'},
                {'id': 'tn', 'label': False, 'confidence': 'low'},
                {'id': 'ungraded', 'label': True, 'confidence': 'high'},
                {'id': 'unlabeled', 'label': None, 'confidence': 'high'}]
        predictions = {'tp': True, 'fp': True, 'fn': False, 'tn': False, 'ungraded': None, 'unlabeled': True}
        all_rows = report.table(rows, predictions, confirmed=False)
        self.assertEqual({k: all_rows[k] for k in ('TP', 'FP', 'FN', 'TN', 'errors', 'excluded')},
                         {'TP': 1, 'FP': 1, 'FN': 1, 'TN': 1, 'errors': 1, 'excluded': 1})
        self.assertEqual((all_rows['FPR'], all_rows['FNR']), (0.5, 0.5))
        confirmed = report.table(rows, predictions, confirmed=True)
        self.assertEqual((confirmed['TN'], confirmed['excluded'], confirmed['FPR']), (0, 2, 1.0))


class MainTest(unittest.TestCase):
    def test_rows_without_id_and_unhealthy_replays_are_errors_not_scores(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            trajectory = tmp / 'trajectory'
            (trajectory / 'scores').mkdir(parents=True)
            score = json.dumps({'outcomeSuccess': True}).encode()
            (trajectory / 'scores/result.json').write_bytes(score)
            manifest = tmp / 'manifest.json'
            manifest.write_text(json.dumps([{'run': str(trajectory), 'taskId': 't', 'group': 'g',
                'files': {'scores/result.json': hashlib.sha256(score).hexdigest()}}]))
            baseline = tmp / 'baseline.json'
            baseline.write_text(json.dumps({'rows': [{'id': str(trajectory), 'label': True, 'confidence': 'high'}]}))
            replay = tmp / 'replay'
            replay.mkdir()
            (replay / 'run.json').write_text(json.dumps(
                {'model': 'm', 'manifestSha256': hashlib.sha256(manifest.read_bytes()).hexdigest()}))
            (replay / '0.json').write_text(json.dumps({'id': str(trajectory), 'result': {
                'outcomeSuccess': True, 'health': {'status': 'error'}}}))
            out = tmp / 'out.json'
            argv = ['report.py', '--manifest', str(manifest), '--baseline', str(baseline),
                    '--runs', str(replay), '--out', str(out)]
            with mock.patch.object(sys, 'argv', argv), mock.patch('builtins.print'):
                report.main()
            result = json.loads(out.read_text())
            primary = result['tables']['confirmed-only primary']
            self.assertEqual(primary['disk gated production outcome']['TP'], 1)
            self.assertEqual((primary[str(replay)]['errors'], primary[str(replay)]['TP']), (1, 0))
            self.assertEqual(result['runHealth'][str(replay)], {'error': 1})


if __name__ == '__main__':
    unittest.main()
