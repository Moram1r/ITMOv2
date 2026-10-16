#!/usr/bin/env bash
set -euo pipefail

# Ensure we run from the project root of this script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Auto-activate local virtualenv if present and not already active
if [ -z "${VIRTUAL_ENV:-}" ] && [ -f ".venv/bin/activate" ]; then
  # shellcheck disable=SC1091
  . ".venv/bin/activate"
fi

# Prefer pytest if available, otherwise try python -m pytest
if command -v pytest >/dev/null 2>&1; then
  pytest -q
else
  if command -v python3 >/dev/null 2>&1; then
    python3 -m pytest -q
  else
    python -m pytest -q
  fi
fi
