#!/bin/sh
set -eu

speckit_tools=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
python3 -m venv "$speckit_tools/.cache/spec-kit/venv"
"$speckit_tools/.cache/spec-kit/venv/bin/python" -m pip install \
  --disable-pip-version-check --index-url https://pypi.org/simple \
  --requirement "$speckit_tools/requirements-spec-kit.txt"
"$speckit_tools/bin/specify" version
