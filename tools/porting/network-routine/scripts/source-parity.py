# SPDX-License-Identifier: GPL-3.0-only
# Additional terms: see LICENSE-ADDITIONAL-TERMS
"""Read-only original-source audit; runs no original imports or native functions.

Executes an explicit AST allowlist of pure functions, then the original assertions
with only pytest.raises and monkeypatch.setattr supplied by this stdlib harness.
No packages are installed and no original files/caches are written.
"""
from __future__ import annotations
import argparse
import ast
import copy
import datetime as dt
import hashlib
import inspect
import ipaddress
import json
from pathlib import Path
import random
import re
import sys
import types
import unicodedata

FUNCTIONS = {
    "ensure_list", "deep_merge", "validate_ipv4", "parse_time", "parse_name_list",
    "names_text", "normalize_wifi_name", "summarize_wifi_names", "wifi_names_signature",
    "decision_mode_label", "decision_mode_value", "normalize_settings_schema", "mode_label",
    "internal_interval_for_date", "merged_internal_intervals", "current_segment_info",
    "wifi_rule_matches", "current_decision_info", "schedule_summary", "validate_settings",
    "clear_stale_manual_override", "next_weekly_boundary", "build_schedule_trigger_specs",
    "format_task_result_code", "format_task_datetime", "parse_version", "is_newer_version",
    "parse_sha256_text", "find_update_assets", "ps_single_quote", "build_updater_script",
}
CONSTANTS = {"DAY_KEYS", "DAY_LABELS", "DECISION_MODE_SCHEDULE", "DECISION_MODE_HYBRID",
             "DECISION_MODE_WIFI_ONLY", "DECISION_MODE_ITEMS", "DECISION_MODE_LABELS",
             "DEFAULT_SETTINGS", "TASK_RESULT_LABELS"}

class Raises:
    def __init__(self, expected): self.expected = expected
    def __enter__(self): return self
    def __exit__(self, kind, value, traceback):
        if kind is None: raise AssertionError("Expected exception was not raised")
        return issubclass(kind, self.expected)

class Patch:
    def __init__(self): self.saved = []
    def setattr(self, obj, name, value):
        self.saved.append((obj, name, getattr(obj, name, None)))
        setattr(obj, name, value)
    def close(self):
        for obj, name, value in reversed(self.saved): setattr(obj, name, value)

def load_pure(source):
    tree = ast.parse(source.read_text(encoding="utf-8-sig"))
    nodes = [ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0)]
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in FUNCTIONS: nodes.append(node)
        elif isinstance(node, ast.Assign) and all(isinstance(t, ast.Name) and t.id in CONSTANTS for t in node.targets): nodes.append(node)
    module = types.ModuleType("network_routine")
    module.__dict__.update(dt=dt, re=re, copy=copy, ipaddress=ipaddress, Path=Path)
    exec(compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])), "<pure-original>", "exec"), module.__dict__)
    module.read_current_wifi_name = lambda adapter: ""
    module.read_visible_wifi_info = lambda adapter: {"names": [], "location_permission_required": False, "elevation_required": False}
    return module

def original_assertions(nr, tests):
    fake_pytest = types.ModuleType("pytest")
    fake_pytest.raises = Raises
    previous = {name: sys.modules.get(name) for name in ("pytest", "network_routine")}
    sys.modules.update(pytest=fake_pytest, network_routine=nr)
    try:
        scope = {}
        exec(compile(tests.read_text(encoding="utf-8-sig"), "<original-test-assertions>", "exec"), scope)
        count = 0
        for name, test in scope.items():
            if not name.startswith("test_") or not callable(test): continue
            patch = Patch()
            try: test(**{"monkeypatch": patch} if "monkeypatch" in inspect.signature(test).parameters else {})
            finally: patch.close()
            count += 1
        return count
    finally:
        for name, old in previous.items():
            if old is None: sys.modules.pop(name, None)
            else: sys.modules[name] = old

def fixture_cases(nr):
    cases = []
    rng = random.Random(1440)
    snapshots = [
        ("", [], False), ("Office", ["Home"], False), ("Home", ["Office"], False),
        ("Other", ["Office"], False), ("", ["Home"], False),
        ("", ["Office", "Home"], False), ("Other", ["Other"], False),
        ("Other", [], False), ("", [], True), ("Straße", [], False),
        ("", ["HOME", " office "], False),
    ]
    for index in range(180):
        settings = copy.deepcopy(nr.DEFAULT_SETTINGS)
        settings["decision_mode"] = ("schedule", "hybrid", "wifi_only")[index % 3]
        settings["wifi_rules"] = {"internal_names": ["Office", "Straße"], "external_names": ["Home"]}
        for day in nr.DAY_KEYS:
            start, end = rng.randrange(1440), rng.randrange(1440)
            settings["schedule"]["days"][day] = {"enabled": rng.choice((True, False)), "start": f"{start//60:02}:{start%60:02}", "end": f"{end//60:02}:{end%60:02}"}
        when = dt.datetime(2026, 7, 6) + dt.timedelta(minutes=index * 71)
        connected, names, permission = snapshots[index % len(snapshots)]
        nr.read_current_wifi_name = lambda adapter, value=connected: value
        nr.read_visible_wifi_info = lambda adapter, value=names, permitted=permission: {"names": value, "location_permission_required": permitted, "elevation_required": False}
        result = nr.current_decision_info(settings, when)
        expected = {key: result[key] for key in ("mode", "segment_id", "source", "start", "end")}
        if "matched_wifi_name" in result: expected["matched_wifi_name"] = result["matched_wifi_name"]
        expected["start"] = expected["start"].isoformat() if expected["start"] else None
        expected["end"] = expected["end"].isoformat() if expected["end"] else None
        boundaries = [{"day_key": item["day_key"], "time": item["time"].strftime("%H:%M")} for item in nr.build_schedule_trigger_specs(settings)]
        cases.append({"settings": settings, "when": when.isoformat(), "wifi": {"connected": connected, "names": names, "location_permission_required": permission, "elevation_required": False}, "expected": expected, "boundaries": boundaries})
    return cases

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    args = parser.parse_args()
    source = args.source / "network_routine.py"
    nr = load_pure(source)
    count = original_assertions(nr, args.source / "test_network_routine.py")
    cases = fixture_cases(nr)
    target = Path(__file__).resolve().parents[1]
    header = "// SPDX-License-Identifier: GPL-3.0-only\n// Additional terms: see LICENSE-ADDITIONAL-TERMS\n// Rebuild with scripts/source-parity.py; synthetic data only.\n"
    provenance = {"originalTests": count, "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(), "unicodeVersion": unicodedata.unidata_version}
    (target / "source-cases.ts").write_text(header + "export const sourceProvenance = " + json.dumps(provenance) + ";\nexport const sourceCases = " + json.dumps(cases, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    # Complete original Python casefold, independent of the JS engine Unicode version.
    mapping = {chr(cp): chr(cp).casefold() for cp in range(sys.maxunicode + 1) if chr(cp).casefold() != chr(cp)}
    (target / "unicode-casefold.ts").write_text(header + "export const casefoldMapping: Readonly<Record<string, string>> = " + json.dumps(mapping, ensure_ascii=True, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(json.dumps({"originalAssertionsPassed": count, "differentialCases": len(cases), "unicodeVersion": unicodedata.unidata_version}))

if __name__ == "__main__": main()
