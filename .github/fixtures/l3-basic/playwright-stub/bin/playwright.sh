#!/usr/bin/env bash
# Stub for the Playwright CLI. The L3 self-test uses it to prove that the
# browser list reaches the package manager as separate arguments and that the
# L3 prepare step ran before the E2E command.
set -euo pipefail
printf '%s\n' "$@" > playwright-install-args.txt
echo "playwright stub received: $*"
