import json
import os
import tempfile
import unittest
from pathlib import Path

from resolve_locked_wrangler import resolve_wrangler_version


class ResolveLockedWranglerTests(unittest.TestCase):
    def test_bun_and_npm_agree(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            root.joinpath("bun.lock").write_text(
                '"wrangler": ["wrangler@4.149.0", {}]',
                encoding="utf-8",
            )
            root.joinpath("package-lock.json").write_text(
                json.dumps(
                    {
                        "packages": {
                            "node_modules/wrangler": {"version": "4.149.0"},
                        }
                    }
                ),
                encoding="utf-8",
            )
            self.assertEqual(resolve_wrangler_version(root), "4.149.0")

    def test_bun_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            root.joinpath("bun.lock").write_text(
                '"wrangler": ["wrangler@4.131.1", {}]',
                encoding="utf-8",
            )
            self.assertEqual(resolve_wrangler_version(root), "4.131.1")

    def test_pnpm_package_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            root.joinpath("pnpm-lock.yaml").write_text(
                "packages:\n\n  wrangler@4.149.0:\n    resolution: {integrity: x}\n",
                encoding="utf-8",
            )
            self.assertEqual(resolve_wrangler_version(root), "4.149.0")

    def test_yarn_classic(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            root.joinpath("yarn.lock").write_text(
                'wrangler@npm:4.149.0:\n  version "4.149.0"\n',
                encoding="utf-8",
            )
            self.assertEqual(resolve_wrangler_version(root), "4.149.0")

    def test_mismatch_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            root.joinpath("bun.lock").write_text(
                '"wrangler": ["wrangler@4.149.0", {}]',
                encoding="utf-8",
            )
            root.joinpath("package-lock.json").write_text(
                json.dumps({"packages": {"node_modules/wrangler": {"version": "4.131.1"}}}),
                encoding="utf-8",
            )
            with self.assertRaises(SystemExit):
                resolve_wrangler_version(root)

    def test_missing_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(SystemExit):
                resolve_wrangler_version(Path(tmp))

    def test_subdirectory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "app"
            root.mkdir()
            root.joinpath("bun.lock").write_text(
                '"wrangler": ["wrangler@1.0.0-beta.12", {}]',
                encoding="utf-8",
            )
            self.assertEqual(resolve_wrangler_version(root), "1.0.0-beta.12")


if __name__ == "__main__":
    unittest.main()
