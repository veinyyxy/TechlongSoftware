import ast
from pathlib import Path
from textwrap import dedent
from types import SimpleNamespace
import unittest
from unittest.mock import Mock


WORKFLOW = Path(__file__).resolve().parents[1] / '.github/workflows/first-open-synthetic-artifacts.yml'
SCRIPT = dedent(WORKFLOW.read_text(encoding='utf-8').split("          python3 - <<'PY'\n", 1)[1].split('\n          PY\n', 1)[0])
DEFINITIONS = {'Stop', 'need', 'poll', 'select_artifact', 'read'}
TREE = ast.parse(SCRIPT, filename=str(WORKFLOW))
CODE = compile(ast.Module(body=[node for node in TREE.body if getattr(node, 'name', None) in DEFINITIONS], type_ignores=[]), str(WORKFLOW), 'exec')
COHORT = 'a' * 32
NAME = f'fo-smoke-{COHORT}-01-inspector-ready'
ARTIFACT = {'name': NAME, 'id': 101}


def page(total, *artifacts):
    return {'total_count': total, 'artifacts': list(artifacts)}


class ArtifactListTest(unittest.TestCase):
    def setUp(self):
        self.sleep = Mock()
        self.log = Mock()
        self.scope = {'time': SimpleNamespace(sleep=self.sleep), 'print': self.log}
        exec(CODE, self.scope)
        self.select, self.poll, self.stop = (self.scope[key] for key in ('select_artifact', 'poll', 'Stop'))

    def test_inconsistent_counts_wait_for_a_consistent_singleton(self):
        results = iter([page(0), page(1), page(0, ARTIFACT), page(2, ARTIFACT), page(1, ARTIFACT)])
        found = self.poll(lambda: self.select(next(results), NAME), 'ARTIFACT_NOT_VISIBLE')
        self.assertIs(found, ARTIFACT)
        self.assertEqual(self.sleep.call_count, 4)
        self.log.assert_any_call('ARTIFACT_LIST_PENDING listed=1 total=2', flush=True)

    def test_disagreement_exhausts_old_budget_without_downloading(self):
        expected = f'/runs/11/artifacts?name={NAME}&per_page=2'
        api = Mock(return_value=page(2, ARTIFACT))
        fetch = Mock()
        self.scope.update(api=api, fetch=fetch, COHORT=COHORT, NAMES=('01-inspector-ready',), inspect=11, writer=22, SELF=22)
        with self.assertRaisesRegex(self.stop, '^ARTIFACT_NOT_VISIBLE$'):
            self.scope['read'](0)
        self.assertEqual(api.call_count, 16)
        api.assert_called_with(expected)
        self.assertEqual(self.sleep.call_count, 15)
        self.sleep.assert_called_with(10)
        fetch.assert_not_called()

    def test_real_duplicate_fails_even_when_count_disagrees(self):
        duplicate = {**ARTIFACT, 'id': 102}
        with self.assertRaisesRegex(self.stop, '^ARTIFACT_NOT_UNIQUE$'):
            self.poll(lambda: self.select(page(1, ARTIFACT, duplicate), NAME), 'ARTIFACT_NOT_VISIBLE')
        self.sleep.assert_not_called()

    def test_filtered_list_with_wrong_name_is_not_accepted(self):
        with self.assertRaisesRegex(self.stop, '^ARTIFACT_LIST_WRONG_NAME$'):
            self.select(page(1, {'name': 'wrong'}), NAME)

    def test_invalid_count_or_list_is_not_accepted(self):
        for invalid in ({'artifacts': [ARTIFACT]}, page(True, ARTIFACT), page('1', ARTIFACT), page(-1), {'total_count': 0, 'artifacts': None}):
            with self.subTest(invalid=invalid), self.assertRaisesRegex(self.stop, '^ARTIFACT_LIST_INVALID$'):
                self.select(invalid, NAME)


if __name__ == '__main__':
    unittest.main()
