# LatencyLens

A VS Code extension that detects C++ performance anti-patterns using AST analysis and proves the fix with real benchmarks compiled on your machine.

## Why This Exists

I started learning C++ for quantitative finance. I'd write what I thought was clean code, then a friend who works at a prop shop would look at it and immediately spot three performance mistakes. Not bugs. The code compiled fine. It just ran 10x slower than it needed to.

The problem is that C++ lets you write slow code that looks correct. `std::map` compiles just as easily as `std::unordered_map`. Passing a vector by value causes zero warnings. `std::endl` in a loop flushes on every iteration and your linter says nothing.

I took a computer architecture class (CMPT 450) that covered cache hierarchies, branch prediction, and memory layout. I already knew why these things were slow at the hardware level. What I didn't have was a tool that connected that knowledge to the code I was writing.

LatencyLens is that tool. It catches the patterns a senior developer would flag during code review, explains why they're slow at the hardware level, and then proves it with actual nanosecond measurements on your machine.

This is not a prototype. It ships as a 500KB `.vsix` with zero external dependencies. No Python server, no Flask, no network calls. Everything runs in the extension host and your local C++ compiler.

## What It Does

1. You open a C++ file
2. LatencyLens parses it into an AST using tree-sitter (not regex)
3. 26 context-aware detectors check for performance anti-patterns
4. You see inline diagnostics explaining what's slow and why
5. Run dynamic analysis above any pattern to compile and compare a real before/after test
6. An analysis panel combines the static explanation, the fix, and the measured runtime impact

**26 patterns detected across 8 categories:**

| Category | Patterns |
|---|---|
| Data Structures | `std::map` vs `unordered_map`, `std::list` vs `vector`, missing `reserve()` |
| Cache and Memory | AoS vs SoA layout, false sharing, pass by value |
| Compiler Hints | `virtual` vs CRTP, `constexpr`, branch prediction, loop size hoisting |
| Smart Pointers | `shared_ptr` vs `unique_ptr`, raw `new`/`delete`, missing `make_unique` |
| I/O and Strings | `std::endl` vs `\n`, `string` copy vs `string_view`, sync I/O overhead |
| Move Semantics | missing `std::move`, `return std::move(local)` anti-pattern, `emplace_back` |
| Correctness | `using namespace std`, C arrays vs `std::array`, missing virtual destructor |
| Runtime Cost | `pow()` vs multiply, `dynamic_cast` overhead, exceptions in hot paths |

Each detection includes:
- AST context checks (is this inside a loop? is there a `reserve()` nearby? is this in a comment?)
- Before/after code showing the exact fix
- A fix hint explaining when and why to apply it
- A speedup context message translating the numbers into real-world impact
- Links to cppreference.com and C++ Core Guidelines

## How Benchmarks Work

When you click "Benchmark" above a detected pattern:

1. An isolated C++ file is written to a temp directory
2. Your local compiler (`g++` or `clang++`) compiles it with `-O2`
3. The benchmark runs and outputs JSON with nanosecond timing
4. The result panel shows before/after bars, speedup factor, code diff, and fix guidance

Local benchmark quality controls (new):
- Runs each benchmark multiple times in separate process invocations (currently 7 samples)
- Reports the **median** timing instead of a single potentially noisy run
- Computes a robust variability estimate (MAD/median) and labels confidence

This follows statistically rigorous benchmarking guidance: use multiple independent runs and report stable summary statistics instead of cherry-picked single measurements.

The benchmark does not modify your source code. If no compiler is found, it falls back to reference data measured on Apple M1 with clang++ -O2. Reference results are clearly labeled.

## Architecture

```
Extension Host (TypeScript, ~500KB packaged)
  |
  +-- tree-sitter WASM parser
  |     Loads C++ grammar, parses source into AST
  |     26 detector functions walk the tree with context
  |
  +-- Benchmark runner
  |     Writes temp .cpp, shells out to g++/clang++ -O2
  |     Parses JSON output, falls back to reference data
  |
  +-- VS Code integration
        Diagnostics (inline warnings)
        CodeLens ("Benchmark" above each pattern)
        Result panel (timing bars, code diff, fix guidance)
        Dashboard (pattern browser)
```

No Python. No server. No network calls. Pure TypeScript + your C++ compiler.

## Install

```bash
cd extension
npm install && npm run compile
npx @vscode/vsce package --no-dependencies --allow-missing-repository
code --install-extension latencylens-*.vsix
```

Open any `.cpp` file. Analysis runs automatically.

## Commands

| Command | Description |
|---|---|
| `LatencyLens: Open Dashboard` | Browse all 26 patterns with explanations |
| `LatencyLens: Analyze Current File` | Run analysis on the active editor |
| `LatencyLens: Toggle On/Off` | Enable or disable analysis |

## Requirements

- VS Code 1.85+
- C++ compiler (optional, for live benchmarks)
