"""Shared helpers."""
from __future__ import annotations

import re

_DUR = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*([smhd])\s*$")
_MULT = {"s": 1, "m": 60, "h": 3600, "d": 86400}


def parse_dur(text: str) -> float:
    """'30m' -> 1800.0 seconds."""
    m = _DUR.match(str(text))
    if not m:
        raise ValueError(f"bad duration: {text!r}")
    return float(m.group(1)) * _MULT[m.group(2)]


def parse_hm(text: str) -> int:
    """'08:30' -> 510, minutes since local midnight."""
    h, m = text.split(":")
    return int(h) * 60 + int(m)


def clip(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))
