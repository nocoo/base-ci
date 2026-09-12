import os
import tempfile
import unittest
import json
from setup_js_core import (
    clean_version,
    validate_exact_version,
    resolve_runtimes,
    normalize_and_validate_dir,
    collect_install_dirs,
    validate_trusted_policy,
    get_install_command,
)

class TestSetupJsCore(unittest.TestCase):
    def test_clean_version(self):
        self.assertEqual(clean_version("v1.4.0"), "1.4.0")
        self.assertEqual(clean_version("  26.8.1 \n"), "26.8.1")
        self.assertEqual(clean_version(""), "")

    def test_validate_exact_version(self):
        validate_exact_version("Node", "26.8.1")
        validate_exact_version("Bun", "1.4.0")
        with self.assertRaises(ValueError):
            validate_exact_version("Node", "latest")
        with self.assertRaises(ValueError):
            validate_exact_version("Node", "22")
        with self.assertRaises(ValueError):
            validate_exact_version("Node", "^1.0.0")
        with self.assertRaises(ValueError):
            validate_exact_version("Node", "stable")

    def test_resolve_runtimes_package_json(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            pkg = {"packageManager": "bun@1.4.0"}
            with open(os.path.join(tmpdir, "package.json"), "w") as f:
                json.dump(pkg, f)
            runtime, node, mgr = resolve_runtimes(tmpdir, "bun", "", "")
            self.assertEqual(runtime, "1.4.0")
            self.assertEqual(node, "26.8.1")
            self.assertEqual(mgr, "bun")

    def test_resolve_runtimes_nvmrc(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with open(os.path.join(tmpdir, ".nvmrc"), "w") as f:
                f.write("v22.14.0\n")
            runtime, node, mgr = resolve_runtimes(tmpdir, "bun", "1.3.11", "")
            self.assertEqual(runtime, "1.3.11")
            self.assertEqual(node, "22.14.0")

    def test_normalize_and_validate_dir_symlink_escape(self):
        with tempfile.TemporaryDirectory() as repo_root:
            with tempfile.TemporaryDirectory() as outside:
                # Create symlink pointing outside repo
                link_path = os.path.join(repo_root, "escape_link")
                os.symlink(outside, link_path)
                with self.assertRaises(ValueError):
                    normalize_and_validate_dir("escape_link", repo_root)

    def test_normalize_and_validate_dir_traversal(self):
        with tempfile.TemporaryDirectory() as repo_root:
            with self.assertRaises(ValueError):
                normalize_and_validate_dir("../outside", repo_root)

    def test_collect_install_dirs_dedup(self):
        with tempfile.TemporaryDirectory() as repo_root:
            os.makedirs(os.path.join(repo_root, "worker"))
            dirs = collect_install_dirs(".", "worker, worker\n.", repo_root)
            self.assertEqual(dirs, [".", "worker"])

    def test_trusted_policy_validation(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            # Missing trustedDependencies must fail
            with open(os.path.join(tmpdir, "package.json"), "w") as f:
                json.dump({"name": "test"}, f)
            with self.assertRaises(ValueError):
                validate_trusted_policy(tmpdir, "bun")

            # Non-bun must fail
            with self.assertRaises(ValueError):
                validate_trusted_policy(tmpdir, "npm")

            # Valid trustedDependencies
            with open(os.path.join(tmpdir, "package.json"), "w") as f:
                json.dump({"trustedDependencies": ["better-sqlite3"]}, f)
            trusted = validate_trusted_policy(tmpdir, "bun")
            self.assertEqual(trusted, ["better-sqlite3"])

    def test_get_install_command(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with open(os.path.join(tmpdir, "bun.lock"), "w") as f:
                f.write("")
            with open(os.path.join(tmpdir, "package.json"), "w") as f:
                json.dump({"trustedDependencies": ["pkg-a"]}, f)

            cmd_blocked = get_install_command(tmpdir, "bun", "blocked")
            self.assertEqual(cmd_blocked, ["bun", "install", "--frozen-lockfile", "--ignore-scripts"])

            cmd_trusted = get_install_command(tmpdir, "bun", "trusted")
            self.assertEqual(cmd_trusted, ["bun", "install", "--frozen-lockfile"])

if __name__ == "__main__":
    unittest.main()
