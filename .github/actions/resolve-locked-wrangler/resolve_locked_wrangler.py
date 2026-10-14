"""Read the exact locked wrangler version from supported package-manager lockfiles."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Callable, Dict, Optional

EXACT = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:[.-][A-Za-z0-9.-]+)?$")

LOCK_READERS: Dict[str, Callable[[Path], Optional[str]]] = {}


def _reader(name: str):
    def decorator(fn: Callable[[Path], Optional[str]]):
        LOCK_READERS[name] = fn
        return fn

    return decorator


@_reader("bun.lock")
def read_bun_lock(path: Path) -> Optional[str]:
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8")
    patterns = (
        r'"wrangler":\s*\[\s*"wrangler@([^"]+)"',
        r'"node_modules/wrangler":\s*\[\s*"wrangler@([^"]+)"',
    )
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(1)
    return None


@_reader("package-lock.json")
def read_package_lock(path: Path) -> Optional[str]:
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    packages = data.get("packages") or {}
    entry = packages.get("node_modules/wrangler")
    if isinstance(entry, dict) and entry.get("version"):
        return str(entry["version"])
    deps = (data.get("dependencies") or {}).get("wrangler")
    if isinstance(deps, dict) and deps.get("version"):
        return str(deps["version"])
    return None


@_reader("pnpm-lock.yaml")
def read_pnpm_lock(path: Path) -> Optional[str]:
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8")
    versions = set(re.findall(r"^\s+wrangler@(\d+\.\d+\.\d+(?:[.-][A-Za-z0-9.-]+)?):", text, re.MULTILINE))
    if len(versions) == 1:
        return versions.pop()
    if len(versions) > 1:
        raise ValueError(f"multiple wrangler versions in pnpm-lock.yaml: {sorted(versions)}")
    match = re.search(
        r"wrangler:\n(?:[ \t]+.+\n)*?[ \t]+version:\s*(\d+\.\d+\.\d+(?:[.-][A-Za-z0-9.-]+)?)",
        text,
    )
    return match.group(1) if match else None


@_reader("yarn.lock")
def read_yarn_lock(path: Path) -> Optional[str]:
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8")
    versions = set()
    for block in re.split(r"\n\n+", text):
        header = block.split("\n", 1)[0].strip()
        if not header.startswith("wrangler@"):
            continue
        match = re.search(r'(?m)^[ \t]*version[ \t]+"([^"]+)"', block)
        if match:
            versions.add(match.group(1))
    if len(versions) == 1:
        return versions.pop()
    if len(versions) > 1:
        raise ValueError(f"multiple wrangler versions in yarn.lock: {sorted(versions)}")
    return None


def resolve_wrangler_version(workdir: Path) -> str:
    found: Dict[str, str] = {}
    for name, reader in LOCK_READERS.items():
        try:
            version = reader(workdir / name)
        except ValueError as exc:
            print(f"::error::{exc}", file=sys.stderr)
            raise SystemExit(1) from exc
        if version:
            found[name] = version
    if not found:
        print(
            "::error::wrangler is not locked in bun.lock, package-lock.json, pnpm-lock.yaml, or yarn.lock",
            file=sys.stderr,
        )
        raise SystemExit(1)
    unique = set(found.values())
    if len(unique) > 1:
        detail = ", ".join(f"{name}={value}" for name, value in sorted(found.items()))
        print(f"::error::lockfile wrangler version mismatch: {detail}", file=sys.stderr)
        raise SystemExit(1)
    version = unique.pop()
    if not EXACT.match(version):
        print(f"::error::locked wrangler version is not exact: {version}", file=sys.stderr)
        raise SystemExit(1)
    return version


def main() -> None:
    raw = (os.environ.get("WORKING_DIRECTORY") or ".").strip() or "."
    workspace = Path(os.environ["GITHUB_WORKSPACE"]).resolve()
    workdir = (workspace / raw).resolve()
    try:
        workdir.relative_to(workspace)
    except ValueError:
        print("::error::working-directory must stay inside the repository", file=sys.stderr)
        raise SystemExit(1)
    version = resolve_wrangler_version(workdir)
    print(f"Locked wrangler {version}")
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as fh:
        fh.write(f"wrangler-version={version}\n")


if __name__ == "__main__":
    main()
