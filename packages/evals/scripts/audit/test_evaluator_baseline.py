import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('baseline', Path(__file__).with_name('evaluator-baseline.py'))
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


class BaselineTests(unittest.TestCase):
    def test_rates_and_confidence(self):
        rows = [dict(raw=True, label=False, confidence='medium'),
                dict(raw=False, label=True, confidence='high'),
                dict(raw=False, label=False, confidence='high')]
        self.assertEqual(b.compare(rows, True)['FPR'], 0)
        self.assertEqual(b.compare(rows, False)['FPR'], .5)
        self.assertEqual(b.compare(rows, True)['FNR'], 1)

    def test_task_split_excludes_other_runs(self):
        rows = [dict(taskId='a', run='1'), dict(taskId='a', run='2'), dict(taskId='b', run='3')]
        self.assertEqual(b.split(rows, rows[:1]), rows[2:])

    def test_unknown_label_is_not_a_negative(self):
        self.assertIsNone(b.label({'_outcome': False}))
        self.assertTrue(b.label({'_outcome': False, 'flip': True}))


if __name__ == '__main__':
    unittest.main()
