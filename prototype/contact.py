"""Proactive contact: layered rate limiting.

All limits are ANDed. The strictest one wins.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from util import parse_dur, parse_hm


@dataclass
class ContactGate:
    cfg: dict
    history: list = field(default_factory=list)   # epoch seconds
    unanswered: int = 0

    @property
    def c(self) -> dict:
        return self.cfg["contact"]

    def _in_window(self, ts: datetime) -> bool:
        s = parse_hm(self.c["window"][0])
        e = parse_hm(self.c["window"][1])
        m = ts.hour * 60 + ts.minute
        return s <= m < e

    def can(self, now: float, has_reason: bool, ts: datetime | None = None) -> tuple[bool, str]:
        c = self.c
        ts = ts or datetime.fromtimestamp(now)

        if not self._in_window(ts):
            return False, "quiet_hours"
        if c.get("require_reason", True) and not has_reason:
            return False, "no_reason"
        if self.unanswered >= c.get("unanswered_stop", 3):
            return False, "unanswered_stop"

        day = [t for t in self.history if now - t < 86400]
        if len(day) >= c["daily_max"]:
            return False, "daily_max"

        if self.history and now - self.history[-1] < parse_dur(c["min_gap"]):
            return False, "min_gap"

        burst = [t for t in self.history if now - t < parse_dur(c["burst"]["per"])]
        if len(burst) >= c["burst"]["max"]:
            return False, "burst"

        return True, "ok"

    def consume(self, now: float) -> None:
        self.history.append(now)

    def on_reply(self) -> None:
        self.unanswered = 0

    def on_no_reply(self) -> None:
        self.unanswered += 1
