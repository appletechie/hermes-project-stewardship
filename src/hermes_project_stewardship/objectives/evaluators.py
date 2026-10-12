"""Objective evaluators: manual and command types (deterministic).

Targets use a small, strict comparison grammar:
    ">=0.99", "<=5", ">90", "<10", "==1", "!=0"
The measured value is:
- command evaluator: exit code 0 => 1.0 else 0.0 (unless the command's stdout
  ends with a single float on the last line — then that float is the measure).
  The last line may instead be a JSON object, ``{"measure": 3, "items":
  [{"id": ..., "label": ..., "detail": ...}]}``: ``measure`` is the measure and
  ``items`` names what it counted (kept as evidence, never as authority);
- manual evaluator: the recorded status passed with evidence.

Command evaluators ALWAYS run through security.allowlist.run_allowlisted.
"""

from __future__ import annotations

import json
import math
import re
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, FrozenSet, Optional

from ..domain.models import Objective, ObjectiveResult
from ..security.allowlist import CommandNotPermitted, run_allowlisted
from ..security.untrusted import clean_text

_TARGET_RE = re.compile(r"^(>=|<=|>|<|==|!=)\s*(-?\d+(?:\.\d+)?)$")

MAX_EVIDENCE_LINE_BYTES = 64 * 1024
MAX_EVIDENCE_ITEMS = 50
MAX_ITEM_FIELD_CHARS = 300
_ITEM_FIELDS = ("id", "label", "detail")


@dataclass
class EvaluationContext:
    project_path: Optional[Path] = None
    allowlist: FrozenSet[str] = frozenset()
    timeout_seconds: int = 60
    github_evidence: Optional[dict] = None
    clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)


def parse_target(target: str):
    m = _TARGET_RE.match(target.strip())
    if not m:
        raise ValueError(
            f"invalid target '{target}'; expected one of >= <= > < == != followed by a number"
        )
    op, num = m.group(1), float(m.group(2))
    return op, num


def _compare(measured: float, target: str) -> bool:
    op, num = parse_target(target)
    return {
        ">=": measured >= num,
        "<=": measured <= num,
        ">": measured > num,
        "<": measured < num,
        "==": measured == num,
        "!=": measured != num,
    }[op]


class ObjectiveEvaluator:
    def evaluate(self, objective: Objective, ctx: EvaluationContext) -> ObjectiveResult:
        if not objective.enabled:
            return ObjectiveResult(objective.id or -1, objective.name, False, None, False,
                                   "not_applicable: objective archived")
        if objective.evaluator_type == "command":
            return self._eval_command(objective, ctx)
        if objective.evaluator_type == "manual":
            return self._eval_manual(objective, ctx)
        if objective.evaluator_type == "integration":
            if objective.integration == "github" and ctx.github_evidence is not None:
                evidence = ctx.github_evidence
                state = evidence.get("state", "unknown")
                measured = (1.0 if state == "passed" else 0.0) if state in {"passed", "failed"} else None
                met = measured is not None and _compare(measured, objective.target)
                return ObjectiveResult(
                    objective_id=objective.id or -1, name=objective.name,
                    passed=state == "passed" and met, measured=measured,
                    target_met=met, detail=str(evidence.get("detail", "unknown: GitHub evidence unavailable")),
                )
            return ObjectiveResult(
                objective_id=objective.id or -1,
                name=objective.name,
                passed=False,
                measured=None,
                target_met=False,
                detail="unavailable: integration collector is not configured",
            )
        raise ValueError(
            f"evaluator_type '{objective.evaluator_type}' not implemented in 0.1.x"
        )

    def _eval_manual(self, objective: Objective, ctx: EvaluationContext) -> ObjectiveResult:
        # Manual objectives are updated by humans/agents WITH evidence via
        # record_manual_status; absence of a recorded status = unknown pass.
        status = getattr(objective, "_manual_status", None)
        if status is None:
            return ObjectiveResult(
                objective_id=objective.id or -1,
                name=objective.name,
                passed=False,
                measured=None,
                target_met=False,
                detail="unknown: no manual status recorded",
            )
        if not status.get("evidence"):
            return ObjectiveResult(
                objective_id=objective.id or -1,
                name=objective.name,
                passed=False,
                measured=None,
                target_met=False,
                detail="unknown: manual result has no evidence",
            )
        recorded_at = status.get("recorded_at")
        if recorded_at:
            try:
                stamp = datetime.fromisoformat(str(recorded_at).replace("Z", "+00:00"))
                window = re.fullmatch(r"([1-9][0-9]{0,3})d", objective.window)
                if stamp.utcoffset() is None or not window or stamp > ctx.clock():
                    raise ValueError("invalid sample time/window")
                if stamp < ctx.clock() - timedelta(days=int(window.group(1))):
                    return ObjectiveResult(objective.id or -1, objective.name, False, None, False,
                                           "stale: manual evidence outside objective window")
            except ValueError:
                return ObjectiveResult(objective.id or -1, objective.name, False, None, False,
                                       "unknown: invalid sample time/window")
        expires_at = status.get("expires_at")
        if expires_at:
            try:
                expiry = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
                if expiry.utcoffset() is None:
                    raise ValueError("evidence expiry requires a timezone")
                if expiry <= ctx.clock():
                    return ObjectiveResult(
                        objective_id=objective.id or -1,
                        name=objective.name,
                        passed=False,
                        measured=None,
                        target_met=False,
                        detail="stale: manual evidence has expired",
                    )
            except ValueError:
                return ObjectiveResult(
                    objective_id=objective.id or -1,
                    name=objective.name,
                    passed=False,
                    measured=None,
                    target_met=False,
                    detail="unknown: invalid manual evidence expiry",
                )
        measured = 1.0 if status["passed"] else 0.0
        met = _compare(measured, objective.target)
        return ObjectiveResult(
            objective_id=objective.id or -1,
            name=objective.name,
            passed=bool(status["passed"]) and met,
            measured=measured,
            target_met=met,
            detail=str(status.get("detail", "")),
        )

    def _eval_command(self, objective: Objective, ctx: EvaluationContext) -> ObjectiveResult:
        assert objective.command, "command objective requires argv"
        if not ctx.project_path or not Path(ctx.project_path).exists():
            return ObjectiveResult(
                objective_id=objective.id or -1,
                name=objective.name,
                passed=False,
                measured=None,
                target_met=False,
                detail=f"project path missing: {ctx.project_path}",
            )
        try:
            result = run_allowlisted(
                [str(c) for c in objective.command],
                cwd=Path(ctx.project_path),
                allowlist=ctx.allowlist,
                timeout_seconds=ctx.timeout_seconds,
            )
        except CommandNotPermitted as e:
            return ObjectiveResult(
                objective_id=objective.id or -1,
                name=objective.name,
                passed=False,
                measured=None,
                target_met=False,
                detail=f"blocked: {e}",
            )
        evidence = None if result.timed_out else _evidence_line(result.stdout)
        measured = evidence[0] if evidence else self._measure(result)
        invalid = evidence[2] if evidence else None
        target_met = _compare(measured, objective.target) if measured is not None else False
        passed = result.ok and target_met  # an unknown measure never passes
        detail = (
            f"exit={result.exit_code}"
            + (" timed_out" if result.timed_out else "")
            + (f" invalid_evidence={invalid}" if invalid else "")
            + (f" stderr_head={result.stderr[:200]}" if result.stderr and not result.ok else "")
        )
        return ObjectiveResult(
            objective_id=objective.id or -1,
            name=objective.name,
            passed=passed,
            measured=measured,
            target_met=target_met,
            detail=detail,
            items=evidence[1] if evidence else None,
        )

    @staticmethod
    def _measure(result) -> Optional[float]:
        """Exit-code-first semantics with optional numeric stdout override."""
        if result.timed_out:
            return None
        lines = [line.strip() for line in (result.stdout or "").splitlines() if line.strip()]
        if lines:
            m = re.fullmatch(r"-?\d+(?:\.\d+)?", lines[-1])
            if m:
                return float(m.group(0))
        return 1.0 if result.ok else 0.0


def _evidence_line(stdout: str):
    """(measure, items, invalid) from a final ``{"measure": ..., "items": [...]}`` line.

    None when the last line does not start with "{", so a bare number or the
    exit code still decides the measure. A line that starts with "{" but is
    not valid evidence gives (None, None, <fixed reason>): an unknown measure,
    never an exception, so the rest of the cycle still runs. Items are
    untrusted command output: at most MAX_EVIDENCE_ITEMS are kept, each with
    only its id/label/detail strings, stripped of control characters and cut
    to MAX_ITEM_FIELD_CHARS.
    """
    lines = [line.strip() for line in (stdout or "").splitlines() if line.strip()]
    if not lines or not lines[-1].startswith("{"):
        return None
    if len(lines[-1].encode("utf-8", errors="replace")) > MAX_EVIDENCE_LINE_BYTES:
        return None, None, "line_too_long"
    try:
        payload = json.loads(lines[-1])
    except (ValueError, TypeError, RecursionError):
        return None, None, "not_json"
    if not isinstance(payload, dict):
        return None, None, "not_an_object"
    measure = payload.get("measure")
    if isinstance(measure, bool) or not isinstance(measure, (int, float)):
        return None, None, "bad_measure"
    try:
        measure = float(measure)
    except OverflowError:
        return None, None, "bad_measure"
    if not math.isfinite(measure):
        return None, None, "bad_measure"
    raw = payload.get("items", [])
    if not isinstance(raw, list) or not all(
        isinstance(item, dict) and all(isinstance(item.get(key, ""), str) for key in _ITEM_FIELDS)
        for item in raw
    ):
        return None, None, "bad_items"
    items = [
        {key: clean_text(item[key], MAX_ITEM_FIELD_CHARS) for key in _ITEM_FIELDS if key in item}
        for item in raw[:MAX_EVIDENCE_ITEMS]
    ]
    return measure, items, None


DEFAULT_EVALUATOR = ObjectiveEvaluator()
