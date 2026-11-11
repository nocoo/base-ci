"""Executable contract for the Z1 slot gate that lives inline in quality.yml."""

import json
import os
import pathlib
import subprocess
import sys
import tempfile
import textwrap
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
QUALITY_WORKFLOW = ROOT / ".github/workflows/quality.yml"
BEGIN_MARKER = "# SLOT_GATE_PYTHON_BEGIN"
END_MARKER = "# SLOT_GATE_PYTHON_END"

SHA = "1" * 40
OTHER_SHA = "2" * 40

SLOT_KEYS = {
    "S1": "S1",
    "S2": "S2",
    "S3": "S3",
    "G1": "G1",
    "G2": "G2",
    "B1": "B1",
    "L1": "L1",
    "L2": "L2",
    "L3": "L3",
    "L4": "L4",
    "P1": "P1",
}
ALL_SLOTS = ["S1", "S2", "S3", "G1", "G2", "B1", "L1", "L2", "L3", "L4", "P1", "Z1"]


def extract_gate_python():
    text = QUALITY_WORKFLOW.read_text(encoding="utf-8")
    assert BEGIN_MARKER in text, "quality.yml is missing the slot gate start marker"
    assert END_MARKER in text, "quality.yml is missing the slot gate end marker"
    start = text.index(BEGIN_MARKER) + len(BEGIN_MARKER)
    end = text.index(END_MARKER)
    return textwrap.dedent(text[start:end])


def slot_states(**overrides):
    """Return the slot state of a healthy run: only S1/S2/L1 are enabled."""
    states = {}
    for slot in ALL_SLOTS:
        if slot == "Z1":
            continue
        if slot in ("S1", "S2", "L1"):
            states[slot] = (True, "success", SHA)
        else:
            states[slot] = (False, "skipped", "")
    states.update(overrides)
    return states


def build_env(states, l1_job_result="success"):
    env = {"SLOT_L1_JOB_RESULT": l1_job_result, "GITHUB_STEP_SUMMARY": ""}
    for slot, (enabled, outcome, sha) in states.items():
        key = SLOT_KEYS[slot]
        env[f"SLOT_{key}_ENABLED"] = "true" if enabled else "false"
        env[f"SLOT_{key}_OUTCOME"] = outcome
        env[f"SLOT_{key}_SHA"] = sha
    return env


def declaration(status_overrides=None, base=None):
    statuses = {
        "S1": {"status": "impl"},
        "S2": {"status": "impl"},
        "S3": {"status": "todo", "reason": "workflow lint is not wired yet"},
        "G1": {"status": "na", "reason": "no secret material in this fixture"},
        "G2": {"status": "na", "reason": "fixture lockfile has no dependencies"},
        "B1": {"status": "todo", "reason": "fixture has no build step"},
        "L1": {"status": "impl"},
        "L2": {"status": "na", "reason": "fixture has no Worker runtime"},
        "L3": {"status": "na", "reason": "fixture exposes no HTTP API"},
        "L4": {"status": "na", "reason": "fixture has no user journeys"},
        "P1": {"status": "todo", "reason": "fixture is not published as a package"},
        "Z1": {"status": "impl"},
    }
    statuses.update(status_overrides or {})
    if base is not None:
        for slot, entry in list(statuses.items()):
            if slot in base:
                statuses[slot] = {**entry, **base[slot]}
    return statuses


def run_gate(slot_status, states=None, l1_job_result="success"):
    states = states if states is not None else slot_states()
    env = dict(os.environ)
    env.update(build_env(states, l1_job_result))
    env["SLOT_STATUS"] = slot_status
    with tempfile.TemporaryDirectory() as tmp:
        script = pathlib.Path(tmp) / "slot_gate.py"
        script.write_text(extract_gate_python(), encoding="utf-8")
        output_file = pathlib.Path(tmp) / "github_output.txt"
        env["GITHUB_OUTPUT"] = str(output_file)
        summary_file = pathlib.Path(tmp) / "summary.md"
        env["GITHUB_STEP_SUMMARY"] = str(summary_file)
        result = subprocess.run(
            [sys.executable, str(script)],
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        output = output_file.read_text(encoding="utf-8") if output_file.exists() else ""
        summary = summary_file.read_text(encoding="utf-8") if summary_file.exists() else ""
    return result, output, summary


class SlotGateTest(unittest.TestCase):
    def assert_rejected(self, result, needle):
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(needle, result.stderr)

    def test_inline_gate_is_valid_python(self):
        compile(extract_gate_python(), "quality.yml#slot-gate", "exec")

    def test_legacy_mode_passes_with_the_boolean_derived_slots(self):
        result, output, _ = run_gate("")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"tested-sha={SHA}", output)

    def test_legacy_mode_rejects_a_failed_enabled_slot(self):
        states = slot_states(**{"G2": (True, "failure", "")})
        result, _, _ = run_gate("", states)
        self.assert_rejected(result, "Required slot G2")

    def test_legacy_mode_rejects_a_disabled_slot_that_ran(self):
        states = slot_states(**{"L4": (False, "success", SHA)})
        result, _, _ = run_gate("", states)
        self.assert_rejected(result, "Disabled slot L4")

    def test_legacy_mode_rejects_a_failed_l1_job(self):
        result, _, _ = run_gate("", l1_job_result="failure")
        self.assert_rejected(result, "The L1 job finished with result 'failure'")

    def test_strict_mode_accepts_a_complete_declaration(self):
        payload = json.dumps(declaration())
        result, output, summary = run_gate(payload)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"tested-sha={SHA}", output)
        self.assertIn("System0 quality slots", summary)

    def test_strict_mode_rejects_deprecated_l15_key(self):
        payload = json.dumps(declaration({"L1.5": {"status": "na", "reason": "old"}}))
        result, _, _ = run_gate(payload)
        self.assert_rejected(result, "deprecated slot L1.5")

    def test_strict_mode_rejects_an_unknown_slot(self):
        payload = json.dumps(declaration({"L9": {"status": "impl"}}))
        result, _, _ = run_gate(payload)
        self.assert_rejected(result, "unknown slots: L9")

    def test_strict_mode_rejects_a_missing_declaration(self):
        statuses = declaration()
        del statuses["L4"]
        result, _, _ = run_gate(json.dumps(statuses))
        self.assert_rejected(result, "missing slot declarations: L4")

    def test_strict_mode_rejects_impl_for_a_disabled_slot(self):
        payload = json.dumps(declaration({"L4": {"status": "impl", "reason": "unused"}}))
        result, _, _ = run_gate(payload)
        self.assert_rejected(result, "declared impl but its job or step is not enabled")

    def test_strict_mode_rejects_na_for_an_enabled_slot(self):
        states = slot_states(**{"L4": (True, "success", SHA)})
        payload = json.dumps(declaration({"L4": {"status": "na", "reason": "no browser"}}))
        result, _, _ = run_gate(payload, states)
        self.assert_rejected(result, "declared na but its job or step is enabled")


if __name__ == "__main__":
    unittest.main()
