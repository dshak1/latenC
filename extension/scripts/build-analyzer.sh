#!/bin/bash
# Build the LatencyLens native C++ analyzer
# This compiles the C++ pattern detection engine that runs as a subprocess.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CPP_DIR="$SCRIPT_DIR/../cpp"
SRC="$CPP_DIR/analyzer.cpp"
BIN="$CPP_DIR/ll_analyzer"

if [ ! -f "$SRC" ]; then
    echo "Error: $SRC not found"
    exit 1
fi

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

echo "Building ll_analyzer with $COMPILER..."
$COMPILER -O2 -std=c++17 -march=native -o "$BIN" "$SRC"
echo "Built: $BIN"

# Quick smoke test
if [ -f "$SCRIPT_DIR/../../examples/sample.cpp" ]; then
    PATTERN_COUNT=$("$BIN" "$SCRIPT_DIR/../../examples/sample.cpp" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")
    echo "Smoke test: detected $PATTERN_COUNT patterns in sample.cpp"
fi
