LatenC (previously latency lens)
See the cost of your C++ code!!!


A VS Code extension that detects C++ performance antipatterns using treesitter AST analysis, explains why theyre slow, and runs real compiled benchmarks to prove it — with interactive visualizations. Zero external dependencies.


i been trying to learn how to get better at writing c++ that is high performance and getting used to thinking about/considering tradeoffs to have better designinstinct and knwoldge so i made this extension to do that 

![LatencyLens](https://img.shields.io/badge/C++Performanceblue?style=forthebadge&logo=cplusplus)
![License](https://img.shields.io/badge/LicenseMITgreen?style=forthebadge)



what does it do tho??
1. Open a C++ file > LatencyLens parses the AST and detects 12 performance antipatterns
2. See inline diagnostics > Squiggly warnings with explanations of why each pattern is slow
3. Click ⚡ Benchmark > Compiles real C++ on your machine (or shows premeasured reference data)
4. Open the Dashboard > Interactive pattern explorer, code analyzer, scaling charts
5. Use AI Work Advisor + Regression Triage > Deterministic workload scoring and benchmark regression diagnosis

No simulation. No estimates. Real compiled C++ benchmarks.



## Patterns Detected

| Pattern | Category | Speedup (up to) |
| std::map > std::unordered_map | Data Structures | 2–5× |
| std::list > std::vector | Cache Locality | 5–20× |
| push_back > reserve + push_back | Memory Allocation | 1.5–3× |
| Virtual dispatch > CRTP | Devirtualization | 2–5× |
| Array of Structs > Struct of Arrays | Cache Optimization | 2–10× |
| Branchy > Branchless | Branch Prediction | 2–4× |
| shared_ptr > unique_ptr | Smart Pointers | 1.5–3× |
| False sharing > Cacheline padding | Concurrency | 2–10× |
| Pass by value > Pass by reference | Function Calls | 1.5–5× |
| std::pow > Multiply | Math | 5–20× |
| std::endl > \n | I/O | 2–10× |
| Loop .size() > Hoisted variable | Loops | 1.2–2× |

Note: Speedups are upper bounds measured on synthetic benchmarks with large N and optimized compilation (O2). Real-world gains depend on data size, access patterns, and compiler optimizations. Run ⚡ Benchmark on your own hardware to see actual numbers.




run this in bash to. install on vscode
code --install-extension extension/latencylens-0.2.0.vsix

Open a .cpp file; LatencyLens activates automatically


Requirements: VS Code 1.85+. Thats it.
Optional: clang++ or g++ for live benchmarks (otherwise uses reference data).



Architecture
VS Code Extension
├── Native C++ analyzer (ll_analyzer binary)
│   └── 20 contextaware pattern detectors in C++17
│   └── Scope tracking, comment stripping, crossline analysis
├── treesitter WASM parser (fallback)
│   └── treesittercpp grammar
├── Dualmode benchmark runner
│   ├── Local: compiles real C++ with clang++/g++ O2
│   └── Reference: premeasured data (honestly labeled)
├── TypeScript bridge (invokes C++ binary, merges results)
└── Webview dashboard (Chart.js)


C++ analyzing C++. The core computation is native. No Python. No server. No network calls.



Project Structure
latencylens/
├── extension/                  # VS Code extension (v0.2.0)
│   ├── cpp/
│   │   └── analyzer.cpp        # Native C++ analysis engine
│   ├── src/
│   │   ├── extension.ts        # Entry point, activation
│   │   ├── analyzer.ts         # Hybrid: native C++ > treesitter > regex
│   │   ├── nativeAnalyzer.ts   # Bridge to C++ binary (subprocess)
│   │   ├── astAnalyzer.ts      # Treesitter AST fallback
│   │   ├── patterns.ts         # Pattern definitions + reference data
│   │   ├── benchmarkRunner.ts  # Dualmode benchmark execution
│   │   ├── dashboard.ts        # Webview panel (postMessage API)
│   │   └── codelens.ts         # CodeLens provider
│   ├── wasm/                   # Treesitter WASM binaries (fallback)
│   ├── scripts/
│   │   └── buildanalyzer.sh   # Builds the C++ analyzer binary
│   └── package.json
├── examples/
│   └── sample.cpp              # File with antipatterns for testing
└── _legacy/                    # Deprecated v0.1.0 proofofconcept
    ├── server/                 # Flask/regex backend (superseded)
    ├── web/                    # Standalone browser dashboard
    └── run.sh





Reliability & Workshop Extensions

 AI Work Advisor (deterministic): Recommends map strategy from operation percentages, value size, map lifetime, clear frequency, and repeatedID rate.
 Regression Triage Assistant: Compares baseline/current throughput, p99 latency, and error rate, then emits severity + likely causes + next actions.
 CI Regression Guard: .github/workflows/ci.yml runs extension build + infra/benchmark_regression_guard.js threshold checks for benchmark snapshots.
 Workshop Assets: workshop/WORKSHOP_PLAN.md and workshop/SLIDES.md provide a 3level educational flow (baseline, optimization, production specialization).



