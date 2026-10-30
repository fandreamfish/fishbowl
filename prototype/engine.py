"""Cognitive core: appraisal -> affect -> decision bias.

Pure functions and dataclasses. No I/O, no model calls.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from util import clip

BASELINE = 0.5


@dataclass
class Temperament:
    """Born-with coefficients. Not a personality description."""
    reactivity: float = 1.0
    baseline_arousal: float = 0.35
    baseline_valence: float = 0.0
    decay_rate: float = 0.85
    salience_threshold: float = 0.30


@dataclass
class Appraisal:
    goal_congruence: float = 0.0
    agency: float = 0.0
    certainty: float = 1.0
    norm_violation: float = 0.0
    relational_impact: float = 0.0
    stake: float = 0.0
    attribution: str = "circumstance"

    def salience(self) -> float:
        return clip(
            0.35 * abs(self.goal_congruence)
            + 0.25 * self.norm_violation
            + 0.20 * abs(self.relational_impact)
            + 0.20 * self.stake,
            0.0, 1.0,
        )


@dataclass
class Affect:
    valence: float = 0.0
    arousal: float = 0.35
    mood: float = 0.0
    longing: float = 0.0   # 缺席累积
    guilt: float = 0.0     # 未修复的违诺，不随时间衰减
    named: dict = field(default_factory=dict)

    # ---- 输入：一次评价事件 ----
    def apply(self, a: Appraisal, t: Temperament) -> None:
        dv = (1.0 * a.goal_congruence * a.stake
              + 0.8 * a.relational_impact
              - 1.2 * a.norm_violation) * t.reactivity
        da = (0.40 * abs(a.goal_congruence)
              + 0.50 * a.norm_violation
              + 0.25 * (1.0 - a.certainty)) * t.reactivity

        self.valence = (t.baseline_valence
                        + t.decay_rate * (self.valence - t.baseline_valence) + dv)
        self.arousal = (t.baseline_arousal
                        + 0.70 * (self.arousal - t.baseline_arousal) + da)
        self.valence = clip(self.valence, -1.0, 1.0)
        self.arousal = clip(self.arousal, 0.0, 1.0)
        self.mood = 0.98 * self.mood + 0.02 * self.valence

        # 违诺只增，只有 repair() 能减
        if a.norm_violation > 0:
            self.guilt = clip(self.guilt + 1.2 * a.norm_violation, 0.0, 1.0)

        self._tag(a)

    def _tag(self, a: Appraisal) -> None:
        for k in list(self.named):
            self.named[k] *= 0.85
            if self.named[k] < 0.02:
                del self.named[k]

        if a.goal_congruence < -0.3 and a.agency > 0.4 and a.certainty > 0.5:
            self.named["frustrated"] = clip(self.named.get("frustrated", 0) + abs(a.goal_congruence), 0, 1)
        if a.norm_violation > 0.2 and a.attribution == "self":
            self.named["guilty"] = clip(self.named.get("guilty", 0) + a.norm_violation, 0, 1)
        if a.relational_impact < -0.2 and a.attribution == "other" and a.certainty < 0.6:
            self.named["wary"] = clip(self.named.get("wary", 0) + abs(a.relational_impact), 0, 1)
        if a.certainty < 0.4 and a.stake > 0.5 and a.agency > 0.4:
            self.named["curious"] = clip(self.named.get("curious", 0) + a.stake, 0, 1)
        if a.relational_impact > 0.3:
            self.named["warm"] = clip(self.named.get("warm", 0) + a.relational_impact, 0, 1)

    # ---- 输入：时间流逝 ----
    def elapse(self, seconds: float, t: Temperament) -> None:
        """Decay transient affect. Persistent terms (guilt) are untouched."""
        if seconds <= 0:
            return
        # 半衰期式衰减，按真实秒数
        k = t.decay_rate ** (seconds / 60.0)
        self.valence = t.baseline_valence + k * (self.valence - t.baseline_valence)
        self.arousal = t.baseline_arousal + k * (self.arousal - t.baseline_arousal)
        self.mood = 0.98 ** (seconds / 60.0) * self.mood + (1 - 0.98 ** (seconds / 60.0)) * self.valence

    def accumulate_absence(self, waking_hours: float) -> None:
        """只在清醒时段累积。睡着时不想念。"""
        import math
        self.longing = clip(0.35 * math.log1p(max(waking_hours, 0.0)), 0.0, 1.0)
        # 想念本身是难受的，不只是"想联系"
        self.valence = clip(self.valence - 0.35 * self.longing, -1.0, 1.0)

    def repair(self, amount: float = 1.0) -> None:
        self.guilt = clip(self.guilt - amount, 0.0, 1.0)


@dataclass
class Bias:
    verbosity: float = BASELINE
    threshold_refuse: float = BASELINE
    threshold_verify: float = BASELINE
    risk_appetite: float = BASELINE
    disclosure: float = BASELINE
    patience: float = BASELINE

    def as_dict(self) -> dict:
        return {
            "verb": self.verbosity, "refu": self.threshold_refuse,
            "veri": self.threshold_verify, "risk": self.risk_appetite,
            "disc": self.disclosure, "pati": self.patience,
        }

    def delta(self) -> dict:
        return {k: v - BASELINE for k, v in self.as_dict().items()}


def in_deadband(aff: Affect, t: Temperament) -> bool:
    return (abs(aff.arousal - t.baseline_arousal) < 0.12
            and abs(aff.valence - aff.mood) < 0.15)


def to_bias(aff: Affect, t: Temperament) -> Bias:
    """Transient terms are deadbanded. Persistent terms (guilt, longing) are not.

    This matters: a deadband that also swallows guilt would make the agent
    'get over' a broken promise simply because no new event arrived.
    """
    quiet = in_deadband(aff, t)
    v = 0.0 if quiet else aff.valence
    ar = 0.0 if quiet else (aff.arousal - t.baseline_arousal)
    wary = aff.named.get("wary", 0.0)

    return Bias(
        verbosity=clip(0.5 + 0.30 * v - 0.40 * ar, 0.0, 1.0),
        threshold_refuse=clip(0.5 + 0.40 * v - 0.25 * wary, 0.0, 1.0),
        threshold_verify=clip(0.5 + 0.45 * aff.guilt + 0.30 * wary + 0.20 * ar, 0.0, 1.0),
        risk_appetite=clip(0.5 + 0.40 * ar - 0.25 * v, 0.0, 1.0),
        disclosure=clip(0.5 + 0.30 * v - 0.45 * wary + 0.30 * aff.longing, 0.0, 1.0),
        patience=clip(0.5 - 0.50 * ar + 0.20 * v, 0.0, 1.0),
    )
