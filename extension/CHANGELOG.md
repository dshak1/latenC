# Changelog

## 0.2.0 — The Zero-Dependency Pivot

### Architecture
- **Killed the Python/Flask backend** — all analysis now runs in-process inside VS Code
- **Tree-sitter AST analysis** via WebAssembly replaces regex pattern matching
- **No server, no Python, no pip** — install the `.vsix` and go

### New Features
- **12 AST-aware pattern detectors** with context-sensitive rules:
  - Skips patterns inside comments
  - Checks for preceding `reserve()` before flagging `push_back` loops
  - Inspects parameter declarations for pass-by-value (only flags containers/strings, not primitives)
  - Verifies `std::pow` arguments are small integer literals before suggesting multiply
  - Detects false sharing only when multiple atomics share the same struct
- **Dual-mode benchmarks**: compiles real C++ locally when `clang++`/`g++` available, falls back to pre-measured reference data (honestly labeled as "📊 Reference")
- **4 new patterns**: pass-by-value, `std::pow` → multiply, `std::endl` → `\n`, loop `.size()` hoisting
- **Confidence levels** on each finding (high / medium / low)

### UX
- Analysis is now instant (~5ms) — no server startup wait
- Auto-analyze delay reduced from 2s to 500ms
- Dashboard communicates via `postMessage` instead of HTTP fetch
- Benchmark results show source badge: 🖥️ Live or 📊 Reference
- New `latencylens.analysisMode` setting: `auto` / `tree-sitter` / `regex`

### Removed
- `latencylens.serverPort` setting (no server needed)
- Python server dependency (`server/` directory no longer used by extension)
- All HTTP/network calls from the extension

## 0.1.0 — Initial Release

- Initial release
- 12 C++ anti-pattern detectors with real compiled benchmarks
- Inline diagnostics (squiggly warnings)
- CodeLens with "⚡ Benchmark" links
- Interactive webview dashboard with Chart.js
- Auto-analyze on save/open
- Scaling analysis charts
