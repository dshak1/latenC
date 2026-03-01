# LatencyLens — C++ Performance Observatory

> Detect C++ performance anti-patterns with **AST analysis**, see explanations, and run **real compiled benchmarks** — all inside VS Code. **Zero external dependencies.**

## Features

- **Tree-sitter AST Analysis** — Context-aware detection that understands your code structure, not just text patterns
- **Inline Diagnostics** — Squiggly warnings on performance anti-patterns as you type
- **CodeLens Benchmarks** — Click "⚡ Benchmark" above any detected pattern to compile & run a real C++ benchmark
- **Interactive Dashboard** — Full webview with pattern explorer, code analyzer, scaling charts
- **12 Anti-Patterns** — map→unordered_map, push_back without reserve, AoS→SoA, false sharing, virtual dispatch, and more
- **Dual-Mode Benchmarks** — Local compilation when a C++ compiler is available, pre-measured reference data otherwise (clearly labeled)
- **Zero Dependencies** — No Python, no server, no pip install. Just install and go.

## How It Works

LatencyLens runs entirely inside VS Code — no external servers or processes:

1. **Parses** your C++ code using [tree-sitter](https://tree-sitter.github.io/) via WebAssembly — real AST, not regex
2. **Detects** 12 performance anti-patterns by walking the syntax tree with context-aware rules (e.g., checks for preceding `reserve()`, verifies loop context, inspects parameter declarations)
3. **Benchmarks** by compiling real C++ programs with your local `clang++` / `g++` when available
4. **Falls back** to pre-measured reference data on machines without a compiler — always honestly labeled as "📊 Reference data"
5. **Visualizes** results in Chart.js-powered interactive charts

## Requirements

- **VS Code 1.85+**
- **Optional:** `clang++` or `g++` with C++17 support (for live benchmarks — otherwise uses reference data)

That's it. No Python, no pip, no server.

## Getting Started

1. Install the `.vsix` — `code --install-extension latencylens-0.2.0.vsix`
2. Open a `.cpp` or `.c` file
3. LatencyLens activates automatically and begins analyzing
4. Click the ⚡ icon in the editor title bar to open the dashboard

## Commands

| Command | Description |
|---------|-------------|
| `LatencyLens: Open Dashboard` | Open the interactive dashboard panel |
| `LatencyLens: Analyze Current File` | Manually trigger analysis |
| `LatencyLens: Benchmark Pattern` | Run a benchmark for a specific pattern |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `latencylens.analyzeOnSave` | `true` | Auto-analyze on save |
| `latencylens.showCodeLens` | `true` | Show benchmark CodeLens |
| `latencylens.analysisMode` | `auto` | Analysis engine: `auto`, `tree-sitter`, or `regex` |

## Architecture

```
VS Code Extension (TypeScript)
├── tree-sitter WASM parser (in-process)
│   └── tree-sitter-cpp grammar
├── 12 AST-based pattern detectors
├── Benchmark runner (local compiler / reference data)
└── Webview dashboard (Chart.js)
```

No network calls. No child processes for analysis. Everything runs in the extension host.

## Detected Patterns

| Pattern | Category | What It Finds |
|---------|----------|---------------|
| map → unordered_map | Containers | `std::map` used without ordering requirement |
| list → vector | Containers | `std::list` where `std::vector` would be faster |
| reserve before push_back | Containers | Missing `reserve()` before loop with `push_back` |
| virtual → CRTP | Dispatch | Virtual dispatch in performance-critical paths |
| AoS → SoA | Memory | Array-of-structs that would benefit from SoA layout |
| Branch → branchless | Branching | Conditional logic replaceable with arithmetic |
| shared_ptr → unique_ptr | Smart Pointers | `shared_ptr` where single ownership suffices |
| False sharing | Concurrency | Adjacent atomics on the same cache line |
| Pass by value | Function Calls | Large objects passed by value instead of reference |
| pow → multiply | Math | `std::pow` with small integer exponents |
| endl → \\n | I/O | `std::endl` forcing unnecessary flushes |
| Loop size hoist | Loops | `.size()` called every iteration in loop condition |
