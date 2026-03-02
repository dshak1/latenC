#!/bin/bash
# Build all LatencyLens native C++ tools
# Part 1: Extension analyzer (extension/cpp/)
# Part 2: Engine tools (engine/) — analyzer, bench_runner, asmdiff

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CPP_DIR="$SCRIPT_DIR/../cpp"
ENGINE_DIR="$SCRIPT_DIR/../../engine"

# Find a compiler
COMPILER=""
for cmd in clang++ g++ c++; do
    if command -v $cmd &>/dev/null; then
        COMPILER=$cmd
        break
    fi
done

if [ -z "$COMPILER" ]; then
    echo "Error: No C++ compiler found (tried clang++, g++, c++)"
    exit 1
fi

echo "Using compiler: $COMPILER"
FLAGS="-O2 -std=c++17 -march=native"

# ── Part 1: Extension analyzer ───────────────────────────────────────

SRC="$CPP_DIR/analyzer.cpp"
BIN="$CPP_DIR/ll_analyzer"

if [ -f "$SRC" ]; then
    echo ""
    echo "Building extension analyzer..."
    $COMPILER $FLAGS -o "$BIN" "$SRC"
    echo "  ✓ $BIN"
else
    echo "  ⚠ $SRC not found, skipping"
fi

# ── Part 2: Engine tools (if engine/ exists) ─────────────────────────

if [ -d "$ENGINE_DIR" ]; then
    echo ""
    echo "Building engine tools..."

    # ll_analyzer (tokenizer-based, advanced)
    if [ -f "$ENGINE_DIR/ll_analyzer.cpp" ]; then
        $COMPILER $FLAGS -o "$ENGINE_DIR/ll_analyzer" "$ENGINE_DIR/ll_analyzer.cpp"
        echo "  ✓ engine/ll_analyzer"
    fi

    # ll_bench_runner (12-pattern benchmark suite)
    if [ -f "$ENGINE_DIR/ll_bench_runner.cpp" ]; then
        $COMPILER $FLAGS -o "$ENGINE_DIR/ll_bench_runner" "$ENGINE_DIR/ll_bench_runner.cpp"
        echo "  ✓ engine/ll_bench_runner"
    fi

    # ll_asmdiff (assembly comparison tool)
    if [ -f "$ENGINE_DIR/ll_asmdiff.cpp" ]; then
        $COMPILER $FLAGS -o "$ENGINE_DIR/ll_asmdiff" "$ENGINE_DIR/ll_asmdiff.cpp"
        echo "  ✓ engine/ll_asmdiff"
    fi

    # ll_engine_test (test suite)
    if [ -f "$ENGINE_DIR/ll_engine_test.cpp" ]; then
        $COMPILER $FLAGS -pthread -o "$ENGINE_DIR/ll_engine_test" "$ENGINE_DIR/ll_engine_test.cpp"
        echo "  ✓ engine/ll_engine_test"
    fi

    # Run tests
    echo ""
    echo "Running engine tests..."
    "$ENGINE_DIR/ll_engine_test"
fi

# ── Smoke test ────────────────────────────────────────────────────────

SAMPLE="$SCRIPT_DIR/../../examples/sample.cpp"
if [ -f "$BIN" ] && [ -f "$SAMPLE" ]; then
    echo ""
    echo "Smoke test..."
    RESULT=$("$BIN" --file "$SAMPLE" 2>/dev/null)
    COUNT=$(echo "$RESULT" | grep -o '"pattern_id"' | wc -l | tr -d ' ')
    echo "  Detected $COUNT patterns in sample.cpp"
fi

echo ""
echo "Build complete ✓"
