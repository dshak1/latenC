# LatencyLens 

**See the cost of your C++ code.**

A VS Code extension that detects C++ performance anti-patterns using **tree-sitter AST analysis**, explains why they're slow, and runs **real compiled benchmarks** to prove it — with interactive visualizations. **Zero external dependencies.**

![LatencyLens](https://img.shields.io/badge/C++-Performance-blue?style=for-the-badge&logo=cplusplus)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

---

## What It Does

1. **Open a C++ file** → LatencyLens parses the AST and detects 12 performance anti-patterns
2. **See inline diagnostics** → Squiggly warnings with explanations of *why* each pattern is slow
3. **Click ⚡ Benchmark** → Compiles real C++ on your machine (or shows pre-measured reference data)
4. **Open the Dashboard** → Interactive pattern explorer, code analyzer, scaling charts

**No simulation. No estimates. Real compiled C++ benchmarks.**

---

## Patterns Detected

| Pattern | Category | Speedup (up to) |
|---------|----------|----------------|
| `std::map` → `std::unordered_map` | Data Structures | 2–5× |
| `std::list` → `std::vector` | Cache Locality | 5–20× |
| `push_back` → `reserve + push_back` | Memory Allocation | 1.5–3× |
| Virtual dispatch → CRTP | Devirtualization | 2–5× |
| Array of Structs → Struct of Arrays | Cache Optimization | 2–10× |
| Branchy → Branchless | Branch Prediction | 2–4× |
| `shared_ptr` → `unique_ptr` | Smart Pointers | 1.5–3× |
| False sharing → Cache-line padding | Concurrency | 2–10× |
| Pass by value → Pass by reference | Function Calls | 1.5–5× |
| `std::pow` → Multiply | Math | 5–20× |
| `std::endl` → `\n` | I/O | 2–10× |
| Loop `.size()` → Hoisted variable | Loops | 1.2–2× |

> **Note:** Speedups are *upper bounds* measured on synthetic benchmarks with large N and optimized compilation (`-O2`). Real-world gains depend on data size, access patterns, and compiler optimizations. Run ⚡ Benchmark on your own hardware to see actual numbers.

---

## Quick Start

### VS Code Extension (recommended)

```bash
# Install the extension
code --install-extension extension/latencylens-0.2.0.vsix

# Open a .cpp file — LatencyLens activates automatically
```

**Requirements:** VS Code 1.85+. That's it.
Optional: `clang++` or `g++` for live benchmarks (otherwise uses reference data).

---

## Architecture

```
VS Code Extension
├── Native C++ analyzer (ll_analyzer binary)
│   └── 20 context-aware pattern detectors in C++17
│   └── Scope tracking, comment stripping, cross-line analysis
├── tree-sitter WASM parser (fallback)
│   └── tree-sitter-cpp grammar
├── Dual-mode benchmark runner
│   ├── Local: compiles real C++ with clang++/g++ -O2
│   └── Reference: pre-measured data (honestly labeled)
├── TypeScript bridge (invokes C++ binary, merges results)
└── Webview dashboard (Chart.js)
```

**C++ analyzing C++.** The core computation is native. No Python. No server. No network calls.

---

## Project Structure

```
latencylens/
├── extension/                  # VS Code extension (v0.2.0)
│   ├── cpp/
│   │   └── analyzer.cpp        # Native C++ analysis engine
│   ├── src/
│   │   ├── extension.ts        # Entry point, activation
│   │   ├── analyzer.ts         # Hybrid: native C++ -> tree-sitter -> regex
│   │   ├── nativeAnalyzer.ts   # Bridge to C++ binary (subprocess)
│   │   ├── astAnalyzer.ts      # Tree-sitter AST fallback
│   │   ├── patterns.ts         # Pattern definitions + reference data
│   │   ├── benchmarkRunner.ts  # Dual-mode benchmark execution
│   │   ├── dashboard.ts        # Webview panel (postMessage API)
│   │   └── codelens.ts         # CodeLens provider
│   ├── wasm/                   # Tree-sitter WASM binaries (fallback)
│   ├── scripts/
│   │   └── build-analyzer.sh   # Builds the C++ analyzer binary
│   └── package.json
├── examples/
│   └── sample.cpp              # File with anti-patterns for testing
└── _legacy/                    # Deprecated v0.1.0 proof-of-concept
    ├── server/                 # Flask/regex backend (superseded)
    ├── web/                    # Standalone browser dashboard
    └── run.sh
```

---

## What Makes the AST Analysis Better Than Regex

| Scenario | Regex | Tree-sitter AST |
|----------|-------|-----------------|
| `std::map` inside a comment |  False positive |  Skipped |
| `push_back` with `reserve()` already called |  False positive |  Checks preceding calls |
| Pass by value on `int` (cheap type) |  Flags it |  Only flags containers/strings |
| `std::pow(x, 2)` — small exponent |  Flags all pow | Checks argument is small integer |
| `std::atomic` in separate structs |  Flags both | Checks same struct context |
| `.size()` in loop with const container | Works | Works + verifies loop structure |

---

## Built With

- **C++17** — Native analysis engine (ll_analyzer) + benchmark programs
- **Tree-sitter** — WebAssembly-based fallback parser for C++ AST
- **TypeScript** — Extension UI, bridge layer, pattern metadata
- **Chart.js** — Interactive visualizations in the dashboard
- **Your CPU** — Where the real work happens

---

*Built for hackathon speed. Ships fast, benchmarks real.*
