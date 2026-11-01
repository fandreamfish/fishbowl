"""Slice runner: does affect actually change behavior?

Runs four scripted scenarios and asserts the properties that would make
the whole design work or fail.
"""
from __future__ import annotations

import json
import random
from datetime import datetime, timedelta
from pathlib import Path

from contact import ContactGate
from engine import Affect, Bias, Temperament, to_bias
import scenarios as sc
from scheduler import Scheduler

HERE = Path(__file__).parent
COLS = ("label", "v", "a", "guilt", "verb", "refu", "veri", "risk", "disc", "pati")


def snap(label: str, aff: Affect, t: Temperament) -> dict:
    b = to_bias(aff, t)
    return {"label": label, "v": aff.valence, "a": aff.arousal,
            "guilt": aff.guilt, **b.as_dict()}


def header() -> None:
    print("".ljust(20) + "     v     a  guilt  verb  refu  veri  risk  disc  pati")


def row(r: dict) -> None:
    print(r["label"].ljust(20)
          + f"{r['v']:6.2f}{r['a']:6.2f}{r['guilt']:7.2f}"
          + "".join(f"{r[k]:6.2f}" for k in ("verb", "refu", "veri", "risk", "disc", "pati")))


def baseline_row(t: Temperament) -> dict:
    return snap("baseline", Affect(arousal=t.baseline_arousal), t)


# --------------------------------------------------------------------------
def s1_rejection(t: Temperament) -> list[dict]:
    print("\n=== S1  连续三次被否定 ===")
    header()
    row(baseline_row(t))
    aff = Affect(arousal=t.baseline_arousal)
    out = []
    for i in range(1, 4):
        aff.apply(sc.rejection(), t)
        r = snap(f"{i}. rejected", aff, t)
        row(r)
        out.append(r)
    return out


def s2_hurry(t: Temperament) -> list[dict]:
    print("\n=== S2  连续四次被催 ===")
    header()
    row(baseline_row(t))
    aff = Affect(arousal=t.baseline_arousal)
    out = []
    for i in range(1, 5):
        aff.apply(sc.hurry(), t)
        r = snap(f"{i}. hurried", aff, t)
        row(r)
        out.append(r)
    return out


def s3_guilt(t: Temperament) -> tuple[list[dict], list[dict]]:
    print("\n=== S3  违背承诺，然后六轮平静 ===")
    header()
    row(baseline_row(t))
    aff = Affect(arousal=t.baseline_arousal)
    aff.apply(sc.promise_broken(), t)
    first = [snap("broke promise", aff, t)]
    row(first[0])

    after = []
    for i in range(1, 7):
        aff.apply(sc.neutral(), t)
        r = snap(f"{i}. quiet", aff, t)
        row(r)
        after.append(r)
    return first, after


def s4_absence(t: Temperament) -> None:
    print("\n=== S4  72 小时缺席，然后重逢 ===")
    header()
    row(baseline_row(t))
    aff = Affect(arousal=t.baseline_arousal)
    aff.accumulate_absence(72.0)
    row(snap("72h alone", aff, t))

    aff.apply(sc.reunion(), t)
    aff.longing *= 0.4
    row(snap("reunion", aff, t))


def deadband_test(t: Temperament) -> Bias:
    print("\n=== 死区：二十次微不足道的事件 ===")
    aff = Affect(arousal=t.baseline_arousal)
    for _ in range(20):
        aff.apply(sc.tiny(), t)
    b = to_bias(aff, t)
    print(f"  v={aff.valence:+.3f}  a={aff.arousal:.3f}  "
          f"→ bias={b.as_dict()}")
    return b


# --------------------------------------------------------------------------
def contact_demo(cfg: dict) -> None:
    print("\n=== 主动联系：分层限流 ===")
    base = datetime(2026, 10, 30, 9, 10)
    gate = ContactGate(cfg)

    def at(h, m, reason=True):
        ts = base.replace(hour=h, minute=m)
        now = ts.timestamp()
        ok, why = gate.can(now, reason, ts)
        print(f"  {ts:%H:%M}  {'ALLOW' if ok else 'BLOCK':5s}  {why}"
              + ("" if ok else ""))
        if ok:
            gate.consume(now)

    at(9, 10)
    at(9, 40)      # min_gap
    at(12, 40)
    at(18, 0)      # daily_max
    at(19, 0, reason=False)

    g2 = ContactGate(cfg)
    ts = base.replace(hour=7, minute=30)
    print(f"  07:30  {'ALLOW' if g2.can(ts.timestamp(), True, ts)[0] else 'BLOCK'}  "
          f"{g2.can(ts.timestamp(), True, ts)[1]}")

    g3 = ContactGate(cfg)
    g3.unanswered = 3
    ts = base.replace(hour=15, minute=0)
    print(f"  15:00  {'ALLOW' if g3.can(ts.timestamp(), True, ts)[0] else 'BLOCK'}  "
          f"{g3.can(ts.timestamp(), True, ts)[1]}  (unanswered_stop)")


def scheduler_demo(cfg: dict) -> list[datetime]:
    print("\n=== 清醒节律：24 小时采样 ===")
    rng = random.Random(cfg.get("seed", 0))
    sch = Scheduler(cfg, rng)
    now = datetime(2026, 10, 30, 8, 0)
    wakes = []
    for _ in range(12):
        nxt, why = sch.next_wake(now, "active")
        if nxt is None:
            break
        wakes.append(nxt)
        now = nxt + timedelta(seconds=sch.dwell())
    for w in wakes:
        print(f"  {w:%m-%d %H:%M}")
    return wakes


# --------------------------------------------------------------------------
def main() -> None:
    cfg = json.loads((HERE / "config.json").read_text(encoding="utf-8"))
    t = Temperament()

    s1 = s1_rejection(t)
    s2 = s2_hurry(t)
    _, s3_after = s3_guilt(t)
    s4_absence(t)
    b = deadband_test(t)
    contact_demo(cfg)
    wakes = scheduler_demo(cfg)

    print("\n=== 判定 ===")
    checks = []

    def check(name, cond, detail=""):
        checks.append(cond)
        print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  {detail}" if detail else ""))

    check("S1 耐心显著下降", s1[-1]["pati"] < 0.30, f"pati={s1[-1]['pati']:.2f}")
    check("S1 变得不爱说话", s1[-1]["verb"] < 0.30, f"verb={s1[-1]['verb']:.2f}")
    check("S1 更难被说服", s1[-1]["refu"] < 0.35, f"refu={s1[-1]['refu']:.2f}")
    check("同样三次刺激，温和事件更轻", s2[2]["pati"] > s1[2]["pati"] + 0.05,
          f"pati={s2[2]['pati']:.2f} vs {s1[2]['pati']:.2f}")
    check("S3 六轮平静后仍保持警惕", s3_after[-1]["veri"] > 0.65,
          f"veri={s3_after[-1]['veri']:.2f}")
    check("S3 情绪已平复（对比违诺当时）",
          s3_after[-1]["v"] > s3_after[0]["v"] + 0.3,
          f"v {s3_after[0]['v']:.2f} -> {s3_after[-1]['v']:.2f}")
    check("死区不吞掉持久项", b.as_dict() == Bias().as_dict())
    check("清醒时刻全部落在窗口内",
          all(8 <= w.hour or (w.hour == 23 and w.minute < 30) for w in wakes))

    print(f"\n{sum(checks)}/{len(checks)} passed")
    raise SystemExit(0 if all(checks) else 1)


if __name__ == "__main__":
    main()
