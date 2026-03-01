#!/bin/bash
# LatencyLens — One-command launcher
# Usage: ./run.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"
PORT=${PORT:-5000}

echo ""
echo "  ⚡ LatencyLens — C++ Performance Observatory"
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check C++ compiler
if command -v clang++ &>/dev/null; then
    echo "  ✓ C++ compiler: $(clang++ --version | head -1)"
elif command -v g++ &>/dev/null; then
    echo "  ✓ C++ compiler: $(g++ --version | head -1)"
else
    echo "  ✗ No C++ compiler found! Install clang++ or g++"
    exit 1
fi

# Check Python
if ! command -v python3 &>/dev/null; then
    echo "  ✗ Python 3 not found!"
    exit 1
fi
echo "  ✓ Python: $(python3 --version)"

# Install Python deps
echo ""
echo "  Installing dependencies..."
cd "$SERVER_DIR"
pip3 install -q -r requirements.txt 2>/dev/null || pip install -q -r requirements.txt 2>/dev/null

echo ""
echo "  Starting server on http://localhost:$PORT"
echo "  Press Ctrl+C to stop"
echo ""

# Open browser after short delay
(sleep 2 && open "http://localhost:$PORT" 2>/dev/null || xdg-open "http://localhost:$PORT" 2>/dev/null || true) &

# Start server
PORT=$PORT python3 app.py
