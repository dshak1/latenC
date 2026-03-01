"""
LatencyLens — Flask API Server

Routes:
    GET  /                          → Serves the web dashboard
    GET  /api/patterns              → List all patterns
    POST /api/analyze               → Analyze C++ code for anti-patterns
    POST /api/benchmark/<id>        → Run a specific pattern benchmark
    POST /api/benchmark/<id>/scale  → Run scaling benchmark (multiple sizes)
    POST /api/compile               → Compile & benchmark custom C++ code
"""

import os
import sys
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from patterns import PATTERNS, get_pattern_by_id, get_pattern_summaries
from benchmark import run_pattern_benchmark, run_scaling_benchmark, compile_and_run, COMPILER
from analyzer import analyze_code

app = Flask(__name__, static_folder=None)
CORS(app)

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web")


# ── Static files ────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(WEB_DIR, "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(WEB_DIR, filename)


# ── API Routes ──────────────────────────────────────────────────

@app.route("/api/info")
def info():
    """System info for the dashboard header."""
    import platform
    return jsonify({
        "compiler": os.path.basename(COMPILER) if COMPILER else None,
        "platform": platform.platform(),
        "arch": platform.machine(),
        "cpu": platform.processor() or "unknown",
    })


@app.route("/api/patterns")
def list_patterns():
    """List all available patterns with summaries."""
    return jsonify(get_pattern_summaries())


@app.route("/api/patterns/<pattern_id>")
def get_pattern(pattern_id):
    """Get full details for a specific pattern."""
    p = get_pattern_by_id(pattern_id)
    if not p:
        return jsonify({"error": f"Pattern '{pattern_id}' not found"}), 404
    # Return everything except the raw benchmark code
    return jsonify({
        "id": p["id"],
        "name": p["name"],
        "category": p["category"],
        "short_desc": p["short_desc"],
        "explanation": p["explanation"],
        "before_label": p["before_label"],
        "after_label": p["after_label"],
        "before_snippet": p["before_snippet"],
        "after_snippet": p["after_snippet"],
    })


@app.route("/api/benchmark/<pattern_id>", methods=["POST"])
def benchmark_pattern(pattern_id):
    """Run a benchmark for a specific pattern."""
    p = get_pattern_by_id(pattern_id)
    if not p:
        return jsonify({"error": f"Pattern '{pattern_id}' not found"}), 404

    body = request.get_json(silent=True) or {}
    data_size = body.get("data_size")
    iterations = body.get("iterations")

    result = run_pattern_benchmark(p, data_size=data_size, iterations=iterations)
    result["pattern_id"] = pattern_id
    result["pattern_name"] = p["name"]
    return jsonify(result)


@app.route("/api/benchmark/<pattern_id>/scale", methods=["POST"])
def benchmark_scaling(pattern_id):
    """Run scaling benchmark across multiple data sizes."""
    p = get_pattern_by_id(pattern_id)
    if not p:
        return jsonify({"error": f"Pattern '{pattern_id}' not found"}), 404

    body = request.get_json(silent=True) or {}
    sizes = body.get("sizes")

    results = run_scaling_benchmark(p, sizes=sizes)
    return jsonify({
        "pattern_id": pattern_id,
        "pattern_name": p["name"],
        "results": results,
    })


@app.route("/api/analyze", methods=["POST"])
def analyze():
    """Analyze C++ code for anti-patterns."""
    body = request.get_json(silent=True) or {}
    code = body.get("code", "")
    if not code.strip():
        return jsonify({"error": "No code provided"}), 400

    findings = analyze_code(code)
    return jsonify({
        "findings": findings,
        "total": len(findings),
    })


@app.route("/api/compile", methods=["POST"])
def compile_custom():
    """Compile and run custom C++ benchmark code."""
    body = request.get_json(silent=True) or {}
    code = body.get("code", "")
    if not code.strip():
        return jsonify({"error": "No code provided"}), 400

    result = compile_and_run(code)
    return jsonify(result)


# ── Main ────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"""
╔══════════════════════════════════════════════════════════╗
║             LatencyLens — C++ Performance Observatory    ║
║                                                          ║
║   Dashboard:  http://localhost:{port}                      ║
║   API:        http://localhost:{port}/api/patterns          ║
║   Compiler:   {os.path.basename(COMPILER) if COMPILER else 'NOT FOUND':48s}║
╚══════════════════════════════════════════════════════════╝
""")
    app.run(host="0.0.0.0", port=port, debug=True)
