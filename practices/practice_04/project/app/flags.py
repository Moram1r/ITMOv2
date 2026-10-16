import regex as re
from typing import Tuple

# Allowed flags for the regex library
ALLOWED_FLAGS = {
    'i': re.IGNORECASE,
    'm': re.MULTILINE,
    's': re.DOTALL,
    'x': re.VERBOSE,
    'a': re.ASCII,
    'L': re.LOCALE,
    'u': re.UNICODE,
}


def parse_flags(flags_str: str | None) -> Tuple[int, list[str]]:
    """
    Parse string like "imx" into bitmask for regex and list of invalids.
    Unknown chars are collected as invalid.
    """
    if not flags_str:
        return 0, []
    mask = 0
    invalid: list[str] = []
    for ch in flags_str:
        if ch in ALLOWED_FLAGS:
            mask |= ALLOWED_FLAGS[ch]
        else:
            invalid.append(ch)
    return mask, invalid
