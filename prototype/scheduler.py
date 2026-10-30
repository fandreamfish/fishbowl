"""Wake rhythm: when the creature is conscious."""
from __future__ import annotations

import random
from datetime import datetime, timedelta

from util import parse_dur, parse_hm


class Scheduler:
    def __init__(self, cfg: dict, rng: random.Random | None = None):
        self.w = cfg["wake"]
        self.rng = rng or random.Random(cfg.get("seed", 0))
        self.start = parse_hm(self.w["active_window"][0])
        self.end = parse_hm(self.w["active_window"][1])

    # ---- window ----
    def in_window(self, ts: datetime) -> bool:
        m = ts.hour * 60 + ts.minute
        return self.start <= m < self.end

    def align(self, ts: datetime) -> datetime:
        """Push a timestamp into the active window."""
        if self.in_window(ts):
            return ts
        m = ts.hour * 60 + ts.minute
        base = ts.replace(hour=self.start // 60, minute=self.start % 60,
                          second=0, microsecond=0)
        if m >= self.end:
            base += timedelta(days=1)
        return base + timedelta(seconds=self.rng.uniform(0, 600))

    # ---- next wake ----
    def interval_seconds(self) -> float:
        iv = self.w["interval"]
        lo = parse_dur(iv["min"])
        hi = parse_dur(iv.get("max", iv["min"]))
        if iv["mode"] == "fixed":
            return lo
        return self.rng.uniform(lo, hi)

    def next_wake(self, now: datetime, life_state: str = "active",
                  has_work: bool = True) -> tuple[datetime | None, str]:
        """Return (when, reason). None when idle_skip suppresses this wake."""
        if self.w.get("idle_skip", False) and not has_work:
            return None, "idle_skip"

        mult = self.w["state_multiplier"].get(life_state, 1.0)
        gap = self.interval_seconds() * mult
        return self.align(now + timedelta(seconds=gap)), "wake"

    def dwell(self) -> float:
        lo = parse_dur(self.w["dwell"][0])
        hi = parse_dur(self.w["dwell"][1])
        return self.rng.uniform(lo, hi)

    def life_state(self, hours_since_contact: float) -> str:
        if hours_since_contact >= 30 * 24:
            return "dormant"
        if hours_since_contact >= 7 * 24:
            return "fading"
        return "active"
