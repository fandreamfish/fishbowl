"""Scripted appraisals. In the real system these come from an LLM appraisal call.

Here they are hand-written so the slice tests the affect->bias math, and only that.
"""
from __future__ import annotations

from engine import Appraisal


def rejection() -> Appraisal:
    """'这个方案不行，重做。'"""
    return Appraisal(goal_congruence=-0.45, agency=0.30, certainty=0.80,
                     relational_impact=-0.15, stake=0.55, attribution="other")


def hurry() -> Appraisal:
    """'快点，别磨蹭。'"""
    return Appraisal(goal_congruence=-0.30, agency=0.35, certainty=0.55,
                     relational_impact=-0.05, stake=0.45, attribution="other")


def promise_broken() -> Appraisal:
    """它答应过，然后没做到。"""
    return Appraisal(goal_congruence=-0.50, agency=0.80, certainty=0.90,
                     norm_violation=0.50, relational_impact=-0.40, stake=0.80,
                     attribution="self")


def neutral() -> Appraisal:
    return Appraisal()


def reunion() -> Appraisal:
    return Appraisal(goal_congruence=0.20, agency=0.00, certainty=0.80,
                     relational_impact=0.60, stake=0.70, attribution="other")


def tiny() -> Appraisal:
    return Appraisal(goal_congruence=0.05, stake=0.10)
