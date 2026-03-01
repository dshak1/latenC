# ⚠️ Legacy — Not the Product

This directory contains the **v0.1.0 proof-of-concept** web dashboard. It is **deprecated** and no longer maintained.

The actual product is the **VS Code extension** in `../extension/`.

## What's here

- `server/` — Flask/Python backend with regex-based pattern detection
- `web/` — Standalone browser dashboard (HTML/CSS/JS)
- `run.sh` — One-command launcher for the web app

## Why it's deprecated

| | v0.1.0 (this) | v0.2.0 (extension) |
|---|---|---|
| Analysis | Regex (false positives) | Tree-sitter AST (context-aware) |
| Install | Python 3.8+, pip, Flask | VS Code only |
| Benchmarks | Requires local compiler | Local compiler or reference data |
| Architecture | Client → HTTP → Python → C++ | In-process TypeScript + WASM |

**Do not use this code as a reference for how LatencyLens works.** See `../extension/src/astAnalyzer.ts` for the current analysis engine.
