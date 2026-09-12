#!/usr/bin/env python3
"""
setup_js_core.py - Helper logic for setup-js composite action.
Handles runtime version resolution, install policy verification,
lockfile checking, path traversal validation, and install command construction.
"""

import os
import sys
import json
import re
import subprocess
from typing import List, Dict, Optional, Tuple

def clean_version(v: Optional[str]) -> str:
    if not v:
        return ""
    v = v.strip().removeprefix("v")
    return v

def validate_exact_version(kind: str, v: str) -> None:
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?', v):
        raise ValueError(f"{kind} version must be an exact version (e.g. 1.4.0, 26.8.1), got '{v}'")

def read_file(path: str) -> str:
    try:
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                return f.read().strip()
    except Exception:
        pass
    return ""

def resolve_runtimes(workdir: str, pkg_mgr: str, req_runtime: str, req_node: str) -> Tuple[str, str, str]:
    """
    Returns (effective_runtime_version, effective_node_version, resolved_pkg_mgr).
    """
    pkg_mgr = pkg_mgr.strip().lower()
    if pkg_mgr not in ("bun", "npm", "pnpm"):
        raise ValueError(f"Unsupported package-manager '{pkg_mgr}'. Must be bun, npm, or pnpm.")

    # 1. Check packageManager in package.json
    pm_name = ""
    pm_version = ""
    for cand in [os.path.join(workdir, "package.json"), "package.json"]:
        raw = read_file(cand)
        if raw:
            try:
                data = json.loads(raw)
                pm = data.get("packageManager", "")
                if pm and "@" in pm:
                    pm_name, pm_version = pm.split("@", 1)
                    pm_name = pm_name.strip().lower()
                    pm_version = clean_version(pm_version)
                    break
            except Exception:
                pass

    # 2. Resolve Node version
    eff_node = clean_version(req_node)
    if not eff_node:
        for p in [os.path.join(workdir, ".nvmrc"), ".nvmrc", os.path.join(workdir, ".node-version"), ".node-version"]:
            content = read_file(p)
            if content:
                eff_node = clean_version(content.splitlines()[0])
                break
    if not eff_node:
        eff_node = "26.8.1"
    validate_exact_version("Node", eff_node)

    # 3. Resolve Runtime version
    eff_runtime = clean_version(req_runtime)
    if not eff_runtime:
        if pkg_mgr == "bun":
            if pm_name == "bun" and pm_version:
                eff_runtime = pm_version
            else:
                for p in [os.path.join(workdir, ".bun-version"), ".bun-version"]:
                    content = read_file(p)
                    if content:
                        eff_runtime = clean_version(content.splitlines()[0])
                        break
                if not eff_runtime:
                    eff_runtime = "1.4.2"
        elif pkg_mgr == "pnpm":
            if pm_name == "pnpm" and pm_version:
                eff_runtime = pm_version
            else:
                eff_runtime = "10.34.5"
        elif pkg_mgr == "npm":
            if pm_name == "npm" and pm_version:
                eff_runtime = pm_version
            else:
                eff_runtime = "11.19.1"

    validate_exact_version(pkg_mgr, eff_runtime)
    return eff_runtime, eff_node, pkg_mgr

def normalize_and_validate_dir(raw: str, repo_root: str) -> str:
    trimmed = raw.strip()
    if not trimmed:
        return ""
    # Check syntax traversal attempts
    parts = trimmed.replace("\\", "/").split("/")
    if ".." in parts or trimmed.startswith("/"):
        raise ValueError(f"Path traversal forbidden: '{trimmed}'")

    repo_real = os.path.realpath(repo_root)
    candidate_path = os.path.join(repo_root, trimmed)
    candidate_real = os.path.realpath(candidate_path)

    # Prevent symlink escaping repo root
    try:
        common = os.path.commonpath([repo_real, candidate_real])
        if common != repo_real:
            raise ValueError(f"Symlink escapes repository root: '{trimmed}' -> '{candidate_real}'")
    except ValueError as e:
        raise ValueError(f"Symlink or path traversal invalid: '{trimmed}' ({e})")

    norm = os.path.normpath(trimmed)
    if norm in ("", "."):
        return "."
    return norm

def collect_install_dirs(workdir: str, extra_input: str, repo_root: str = ".") -> List[str]:
    dirs = []
    d0 = normalize_and_validate_dir(workdir, repo_root)
    if d0:
        dirs.append(d0)

    if extra_input:
        raw_lines = extra_input.replace(",", "\n").splitlines()
        for line in raw_lines:
            nd = normalize_and_validate_dir(line, repo_root)
            if nd:
                dirs.append(nd)

    # Portable deduplication preserving order
    return list(dict.fromkeys(dirs))

def validate_trusted_policy(dir_path: str, pkg_mgr: str) -> List[str]:
    """
    Validates trustedDependencies for Bun.
    Npm and pnpm do not support trustedDependencies; in 'trusted' policy they must be rejected.
    Returns list of trusted packages for Bun.
    """
    if pkg_mgr != "bun":
        raise ValueError(
            f"install-policy 'trusted' is only supported for Bun (validates package.json#trustedDependencies). "
            f"For {pkg_mgr}, use 'blocked' or 'project'."
        )

    pkg_json = os.path.join(dir_path, "package.json")
    if not os.path.isfile(pkg_json):
        raise ValueError(f"Missing package.json in '{dir_path}' for trusted policy validation.")

    with open(pkg_json, "r", encoding="utf-8") as f:
        data = json.load(f)

    trusted = data.get("trustedDependencies")
    if trusted is None:
        raise ValueError(
            f"Directory '{dir_path}' uses install-policy 'trusted' but package.json has no 'trustedDependencies' field. "
            f"Must define an explicit array (or use install-policy 'blocked' / 'project')."
        )
    if not isinstance(trusted, list):
        raise ValueError(f"package.json#trustedDependencies in '{dir_path}' must be a list.")
    for item in trusted:
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"Invalid item in trustedDependencies in '{dir_path}': {item!r}")
    return trusted

def get_install_command(dir_path: str, pkg_mgr: str, policy: str) -> List[str]:
    if policy not in ("blocked", "trusted", "project"):
        raise ValueError(f"Invalid install-policy '{policy}'. Must be blocked, trusted, or project.")

    if pkg_mgr == "bun":
        has_lock = os.path.isfile(os.path.join(dir_path, "bun.lock")) or os.path.isfile(os.path.join(dir_path, "bun.lockb"))
        if not has_lock:
            raise FileNotFoundError(f"Missing bun lockfile (bun.lock / bun.lockb) in '{dir_path}' for frozen install.")
        cmd = ["bun", "install", "--frozen-lockfile"]
        if policy == "blocked":
            cmd.append("--ignore-scripts")
        elif policy == "trusted":
            validate_trusted_policy(dir_path, "bun")
            # In trusted mode, Bun natively respects package.json#trustedDependencies when not using --ignore-scripts
        return cmd

    elif pkg_mgr == "npm":
        has_lock = os.path.isfile(os.path.join(dir_path, "package-lock.json")) or os.path.isfile(os.path.join(dir_path, "npm-shrinkwrap.json"))
        if not has_lock:
            raise FileNotFoundError(f"Missing package-lock.json in '{dir_path}' for frozen install (npm ci).")
        if policy == "trusted":
            raise ValueError("install-policy 'trusted' is not supported for npm. Use 'blocked' or 'project'.")
        cmd = ["npm", "ci"]
        if policy == "blocked":
            cmd.append("--ignore-scripts")
        return cmd

    elif pkg_mgr == "pnpm":
        has_lock = os.path.isfile(os.path.join(dir_path, "pnpm-lock.yaml"))
        if not has_lock:
            raise FileNotFoundError(f"Missing pnpm-lock.yaml in '{dir_path}' for frozen install.")
        if policy == "trusted":
            raise ValueError("install-policy 'trusted' is not supported for pnpm. Use 'blocked' or 'project'.")
        cmd = ["pnpm", "install", "--frozen-lockfile"]
        if policy == "blocked":
            cmd.append("--ignore-scripts")
        return cmd

    raise ValueError(f"Unsupported package manager: {pkg_mgr}")

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ""

    if mode == "resolve":
        workdir = os.environ.get("IN_WORKDIR", ".")
        pkg_mgr = os.environ.get("IN_PKG_MGR", "bun")
        req_runtime = os.environ.get("IN_RUNTIME_VERSION", "")
        req_node = os.environ.get("IN_NODE_VERSION", "")

        eff_runtime, eff_node, pkg_mgr = resolve_runtimes(workdir, pkg_mgr, req_runtime, req_node)
        github_output = os.environ.get("GITHUB_OUTPUT")
        if github_output:
            with open(github_output, "a", encoding="utf-8") as f:
                f.write(f"effective-runtime-version={eff_runtime}\n")
                f.write(f"effective-node-version={eff_node}\n")
        print(f"Resolved: package-manager={pkg_mgr}, runtime={eff_runtime}, node={eff_node}")

    elif mode == "install":
        workdir = os.environ.get("IN_WORKDIR", ".")
        pkg_mgr = os.environ.get("IN_PKG_MGR", "bun").strip().lower()
        policy = os.environ.get("IN_POLICY", "blocked").strip()
        extra_input = os.environ.get("IN_EXTRA_DIRS", "").strip()
        repo_root = "."

        dirs = collect_install_dirs(workdir, extra_input, repo_root)
        for d in dirs:
            if not os.path.isdir(d):
                raise FileNotFoundError(f"Install directory '{d}' does not exist.")

        for d in dirs:
            cmd = get_install_command(d, pkg_mgr, policy)
            cmd_str = " ".join(cmd)
            print(f"::group::Install in '{d}' ({cmd_str})")
            res = subprocess.run(cmd, cwd=d)
            if res.returncode != 0:
                sys.exit(res.returncode)
            print("::endgroup::")

    else:
        sys.stderr.write(f"Unknown mode '{mode}'. Use 'resolve' or 'install'.\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
