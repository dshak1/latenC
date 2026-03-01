"""
LatencyLens — C++ Benchmark Runner

Compiles and executes real C++ benchmark code, returning timing data.
No simulation — these are actual compiled binaries running on your hardware.
"""

import subprocess
import tempfile
import os
import json
import shutil
import platform


def find_compiler():
    """Find a C++ compiler on the system."""
    for compiler in ["clang++", "g++", "c++"]:
        path = shutil.which(compiler)
        if path:
            return path
    return None


COMPILER = find_compiler()
# Optimization flags for realistic benchmarks
OPT_FLAGS = ["-O2", "-std=c++17", "-DNDEBUG"]

if platform.system() == "Darwin":
    OPT_FLAGS.append("-march=native")
elif platform.system() == "Linux":
    OPT_FLAGS.extend(["-march=native", "-pthread"])


def compile_and_run(cpp_code, data_size=None, iterations=None, timeout=30, extra_flags=None):
    """
    Compile C++ benchmark code, execute it, and return JSON results.
    
    Returns dict with:
        - before_ns: nanoseconds for the 'before' (unoptimized) version
        - after_ns: nanoseconds for the 'after' (optimized) version
        - data_size: N elements used
        - iterations: number of benchmark iterations
        - speedup: how many times faster the 'after' version is
        - error: error message if compilation/execution failed
    """
    if not COMPILER:
        return {"error": "No C++ compiler found. Install clang++ or g++."}

    tmpdir = tempfile.mkdtemp(prefix="latencylens_")
    src_path = os.path.join(tmpdir, "bench.cpp")
    bin_path = os.path.join(tmpdir, "bench")

    try:
        # Write source
        with open(src_path, "w") as f:
            f.write(cpp_code)

        # Build compile command
        cmd = [COMPILER] + OPT_FLAGS + [src_path, "-o", bin_path]
        if extra_flags:
            cmd = [COMPILER] + OPT_FLAGS + extra_flags + [src_path, "-o", bin_path]
        if data_size is not None:
            cmd.insert(1, f"-DDATA_SIZE={data_size}")
        if iterations is not None:
            cmd.insert(1, f"-DITERATIONS={iterations}")

        # Compile
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            return {
                "error": f"Compilation failed:\n{result.stderr}",
                "compiler": COMPILER,
                "flags": " ".join(cmd),
            }

        # Execute
        result = subprocess.run(
            [bin_path],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode != 0:
            return {"error": f"Execution failed:\n{result.stderr}"}

        # Parse JSON output from the benchmark
        output = result.stdout.strip()
        try:
            data = json.loads(output)
        except json.JSONDecodeError:
            return {"error": f"Invalid benchmark output: {output}"}

        # Calculate speedup
        if data.get("after_ns", 0) > 0:
            data["speedup"] = round(data["before_ns"] / data["after_ns"], 2)
        else:
            data["speedup"] = 0

        data["compiler"] = os.path.basename(COMPILER)
        data["opt_level"] = "O2"
        return data

    except subprocess.TimeoutExpired:
        return {"error": "Benchmark timed out (exceeded 30s)"}
    except Exception as e:
        return {"error": str(e)}
    finally:
        # Cleanup
        shutil.rmtree(tmpdir, ignore_errors=True)


def run_pattern_benchmark(pattern, data_size=None, iterations=None):
    """Run a specific pattern's benchmark with optional size override."""
    return compile_and_run(
        pattern["benchmark_code"],
        data_size=data_size,
        iterations=iterations,
    )


def run_scaling_benchmark(pattern, sizes=None):
    """
    Run a pattern at multiple data sizes to show scaling behavior.
    Returns a list of results, one per size.
    """
    if sizes is None:
        sizes = [1000, 10000, 100000, 1000000]

    results = []
    for size in sizes:
        result = compile_and_run(
            pattern["benchmark_code"],
            data_size=size,
            iterations=3,
        )
        result["requested_size"] = size
        results.append(result)

    return results
