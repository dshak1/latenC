"""
LatencyLens — C++ Code Analyzer

Regex-based detection of common C++ performance anti-patterns.
This is intentionally simple — accuracy over cleverness for hackathon reliability.
"""

import re
from patterns import PATTERNS


def analyze_code(source_code):
    """
    Scan C++ source code for known performance anti-patterns.
    
    Returns list of findings, each with:
        - pattern_id: which pattern was detected
        - pattern_name: human-readable name
        - line_numbers: where in the code the pattern was found
        - severity: how impactful this typically is (high/medium/low)
        - explanation: why this matters
    """
    lines = source_code.split("\n")
    findings = []

    for pattern in PATTERNS:
        regex = pattern.get("detection_regex")
        if not regex:
            continue

        matches = []
        try:
            for i, line in enumerate(lines, 1):
                # Skip comments
                stripped = line.strip()
                if stripped.startswith("//") or stripped.startswith("/*"):
                    continue
                if re.search(regex, line):
                    matches.append({
                        "line": i,
                        "text": line.strip(),
                    })
        except re.error:
            continue

        if matches:
            findings.append({
                "pattern_id": pattern["id"],
                "pattern_name": pattern["name"],
                "category": pattern["category"],
                "short_desc": pattern["short_desc"],
                "explanation": pattern["explanation"],
                "matches": matches,
                "before_label": pattern["before_label"],
                "after_label": pattern["after_label"],
                "before_snippet": pattern["before_snippet"],
                "after_snippet": pattern["after_snippet"],
                "severity": _estimate_severity(pattern["id"], len(matches)),
            })

    return findings


def _estimate_severity(pattern_id, match_count):
    """Rough severity based on pattern type and frequency."""
    high_impact = {"list_vs_vector", "aos_vs_soa", "false_sharing", "branch_vs_branchless", "pass_by_value", "pow_vs_multiply"}
    medium_impact = {"map_vs_unordered", "virtual_vs_crtp", "reserve_pattern", "loop_size_hoist"}
    low_impact = {"endl_vs_newline"}
    
    if pattern_id in high_impact:
        return "high"
    elif pattern_id in medium_impact:
        return "medium" if match_count > 1 else "medium"
    elif pattern_id in low_impact:
        return "low" if match_count < 3 else "medium"
    else:
        return "low"


def analyze_file(filepath):
    """Analyze a C++ file from disk."""
    with open(filepath, "r") as f:
        source = f.read()
    return analyze_code(source)
