"""Executable contract for the Z1 slot gate that lives inline in quality.yml.

The gate logic is intentionally embedded in the reusable workflow so that the
provider never needs an extra composite action to be re-pinned. These tests
extract that inline Python from `.github/workflows/quality.yml` and run it
against slot states, so the shipped workflow and the local test suite can
never drift apart.
"""

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

STEP_SLOTS = {"S1": "S1", "S2": "S2", "L1": "L1"}
JOB_SLOTS = {
    "S3": "S3",
    "G1": "G1",
    "G2": "G2",
    "B1": "B1",
    "L1.5": "L15",
    "L2": "L2",
    "L3": "L3",
    "P1": "P1",
}
ALL_SLOTS = ["S1", "S2", "S3", "G1", "G2", "B1", "L1", "L1.5", "L2", "L3", "P1", "Z1"]


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


def build_env(states, host_result="success", host_sha=SHA):
    env = {"SLOT_HOST_RESULT": host_result, "SLOT_HOST_SHA": host_sha}
    for slot, (enabled, outcome, sha) in states.items():
        key = STEP_SLOTS.get(slot) or JOB_SLOTS[slot]
        env[f"SLOT_{key}_ENABLED"] = "true" if enabled else "false"
        env[f"SLOT_{key}_OUTCOME"] = outcome
        if slot not in STEP_SLOTS:
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
        "L1.5": {"status": "na", "reason": "fixture has no Worker runtime"},
        "L2": {"status": "na", "reason": "fixture exposes no HTTP API"},
        "L3": {"status": "na", "reason": "fixture has no browser UI"},
        "P1": {"status": "todo", "reason": "fixture is not published as a package"},
        "Z1": {"status": "impl"},
    }
    statuses.update(status_overrides or {})
    if base is not None:
        for slot, entry in list(statuses.items()):
            if slot in base:
                statuses[slot] = {**entry, **base[slot]}
    return statuses


def run_gate(slot_status, states=None, host_result="success", host_sha=SHA):
    states = states if states is not None else slot_states()
    env = dict(os.environ)
    env.update(build_env(states, host_result, host_sha))
    env["SLOT_STATUS"] = slot_status
    with tempfile.TemporaryDirectory() as tmp:
        script = pathlib.Path(tmp) / "slot_gate.py"
        script.write_text(extract_gate_python(), encoding="utf-8")
        output_file = pathlib.Path(tmp) / "github_output.txt"
        env["GITHUB_OUTPUT"] = str(output_file)
        result = subprocess.run(
            [sys.executable, str(script)],
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        output = output_file.read_text(encoding="utf-8") if output_file.exists() else ""
    return result, output


class SlotGateTest(unittest.TestCase):
    def assert_rejected(self, result, needle):
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(needle, result.stderr)

    def test_inline_gate_is_valid_python(self):
        compile(extract_gate_python(), "quality.yml#slot-gate", "exec")

    def test_legacy_mode_passes_with_the_boolean_derived_slots(self):
        result, output = run_gate("")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"tested-sha={SHA}", output)

    def test_legacy_mode_rejects_a_failed_enabled_slot(self):
        states = slot_states(**{"G2": (True, "failure", "")})
        result, _ = run_gate("", states)
        self.assert_rejected(result, "Required slot G2")

    def test_legacy_mode_rejects_a_disabled_slot_that_ran(self):
        states = slot_states(**{"L3": (False, "success", SHA)})
        result, _ = run_gate("", states)
        self.assert_rejected(result, "Disabled slot L3")

    def test_legacy_mode_rejects_a_failed_host_job(self):
        result, _ = run_gate("", host_result="failure", host_sha="")
        self.assert_rejected(result, "hosting S1/S2/L1")

    def test_strict_mode_accepts_a_complete_declaration(self):
        payload = json.dumps(declaration())
        result, output = run_gate(payload)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"tested-sha={SHA}", output)

    def test_strict_mode_rejects_an_empty_object(self):
        result, _ = run_gate("{}")
        self.assert_rejected(result, "missing slot declarations")

    def test_strict_mode_rejects_malformed_json(self):
        result, _ = run_gate("{not json")
        self.assert_rejected(result, "not valid JSON")

    def test_strict_mode_rejects_an_unknown_slot(self):
        payload = json.dumps(declaration({"L9": {"status": "impl"}}))
        result, _ = run_gate(payload)
        self.assert_rejected(result, "unknown slots: L9")

    def test_strict_mode_rejects_an_illegal_status(self):
        payload = json.dumps(declaration({"L3": {"status": "maybe"}}))
        result, _ = run_gate(payload)
        self.assert_rejected(result, "invalid status 'maybe'")

    def test_strict_mode_rejects_na_without_a_reason(self):
        payload = json.dumps(declaration({"L3": {"status": "na", "reason": "  "}}))
        result, _ = run_gate(payload)
        self.assert_rejected(result, "requires a non-empty reason")

    def test_strict_mode_rejects_todo_without_a_reason(self):
        payload = json.dumps(declaration({"L3": {"status": "todo"}}))
        result, _ = run_gate(payload)
        self.assert_rejected(result, "requires a non-empty reason")

    def test_strict_mode_rejects_a_reason_that_is_not_a_string(self):
        for reason in (None, False, 0, [], {}):
            with self.subTest(reason=reason):
                payload = json.dumps(declaration({"L3": {"status": "na", "reason": reason}}))
                result, _ = run_gate(payload)
                self.assert_rejected(result, "requires a non-empty reason")

    def test_strict_mode_rejects_a_todo_reason_that_is_not_a_string(self):
        for reason in (None, False, 0, [], {}):
            with self.subTest(reason=reason):
                payload = json.dumps(declaration({"L3": {"status": "todo", "reason": reason}}))
                result, _ = run_gate(payload)
                self.assert_rejected(result, "requires a non-empty reason")

    def test_strict_mode_rejects_a_missing_declaration(self):
        statuses = declaration()
        del statuses["L3"]
        result, _ = run_gate(json.dumps(statuses))
        self.assert_rejected(result, "missing slot declarations: L3")

    def test_strict_mode_rejects_a_non_object_declaration(self):
        result, _ = run_gate('["L1"]')
        self.assert_rejected(result, "must be a JSON object")

    def test_strict_mode_rejects_impl_for_a_disabled_slot(self):
        payload = json.dumps(declaration({"L3": {"status": "impl", "reason": "unused"}}))
        result, _ = run_gate(payload)
        self.assert_rejected(result, "declared impl but its job or step is not enabled")

    def test_strict_mode_rejects_an_unexpected_skip(self):
        states = slot_states(**{"L3": (True, "skipped", "")})
        payload = json.dumps(declaration({"L3": {"status": "impl"}}))
        result, _ = run_gate(payload, states)
        self.assert_rejected(result, "finished with outcome 'skipped'")

    def test_strict_mode_rejects_impl_for_a_skipped_slot(self):
        states = slot_states(**{"L3": (False, "skipped", "")})
        payload = json.dumps(declaration({"L3": {"status": "impl"}}))
        result, _ = run_gate(payload, states)
        self.assert_rejected(result, "declared impl but its job or step is not enabled")

    def test_strict_mode_rejects_na_for_an_enabled_slot(self):
        states = slot_states(**{"L3": (True, "success", SHA)})
        payload = json.dumps(declaration({"L3": {"status": "na", "reason": "no browser"}}))
        result, _ = run_gate(payload, states)
        self.assert_rejected(result, "declared na but its job or step is enabled")

    def test_strict_mode_rejects_na_for_a_slot_that_ran(self):
        states = slot_states(**{"L3": (False, "success", SHA)})
        payload = json.dumps(declaration({"L3": {"status": "na", "reason": "no browser"}}))
        result, _ = run_gate(payload, states)
        self.assert_rejected(result, "declared na but its job or step ran")

    def test_strict_mode_rejects_a_sha_mismatch(self):
        states = slot_states(**{"S3": (True, "success", OTHER_SHA)})
        payload = json.dumps(declaration({"S3": {"status": "impl"}}))
        result, _ = run_gate(payload, states)
        self.assert_rejected(result, "Commit SHA mismatch between slot S1 and slot S3")

    def test_strict_mode_requires_z1_to_be_impl(self):
        payload = json.dumps(declaration({"Z1": {"status": "na", "reason": "gate disabled"}}))
        result, _ = run_gate(payload)
        self.assert_rejected(result, "Z1 must be impl")

    def test_strict_mode_requires_an_implemented_slot(self):
        statuses = declaration()
        for slot in ALL_SLOTS:
            if slot == "Z1":
                continue
            statuses[slot] = {"status": "na", "reason": "not applicable"}
        states = slot_states(
            **{
                "S1": (False, "skipped", ""),
                "S2": (False, "skipped", ""),
                "L1": (False, "skipped", ""),
            }
        )
        result, _ = run_gate(json.dumps(statuses), states)
        self.assert_rejected(result, "no implemented slot besides Z1")

    def test_strict_mode_rejects_a_host_job_sha_mismatch(self):
        states = slot_states(
            **{
                "S1": (False, "skipped", ""),
                "S2": (False, "skipped", ""),
                "L1": (False, "skipped", ""),
                "S3": (True, "success", OTHER_SHA),
            }
        )
        statuses = declaration()
        for slot in ALL_SLOTS:
            if slot in ("S3", "Z1"):
                continue
            statuses[slot] = {"status": "na", "reason": "not applicable"}
        statuses["S3"] = {"status": "impl"}
        result, _ = run_gate(json.dumps(statuses), states)
        self.assert_rejected(result, "Commit SHA mismatch between slot S3 and slot S1/S2/L1 host job")

    def test_strict_mode_allows_todo_slots(self):
        states = slot_states()
        payload = json.dumps(declaration({"B1": {"status": "todo", "reason": "planned later"}}))
        result, output = run_gate(payload, states)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"tested-sha={SHA}", output)


if __name__ == "__main__":
    unittest.main()
