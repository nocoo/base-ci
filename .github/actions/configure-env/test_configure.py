import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from configure import configure, parse_environment


class EnvironmentTest(unittest.TestCase):
    def test_rejects_invalid_shapes_and_reserved_values(self):
        for value in [[], {'bad-key': 'x'}, {'GITHUB_TOKEN': 'x'}, {'NODE_OPTIONS': 'x'}, {'COUNT': 1}, {'X': 'a\0b'}]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_environment(json.dumps(value))

    def test_masks_each_secret_and_preserves_multiline_values(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'env'
            logs = io.StringIO()
            with contextlib.redirect_stdout(logs):
                configure('{"APP_ENV":"local","CI":"false"}', '{"TEST_KEY":"first%line\\nsecond"}', output)
            self.assertEqual(logs.getvalue(), '::add-mask::first%25line%0Asecond\n')
            content = output.read_text()
            self.assertIn('\nfirst%line\nsecond\n', content)
            self.assertIn('\ntrue\n', content)
            self.assertNotIn('\nfalse\n', content)

    def test_invalid_input_does_not_partially_write_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'env'
            with self.assertRaises(ValueError):
                configure('{"OK":"yes"}', '{"BAD":false}', output)
            self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
