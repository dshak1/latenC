# latenC

i was trying to get better at writing high performance c++ and actually thinking in tradeoffs, so i made a vs code extension that calls me out when the code is slow and then proves it.

mountain madness, software systems prize (the latency track). i wanted the computer to measure something, not a blog post about big-o.

open a .cpp file. it walks the tree-sitter ast, flags antipatterns, explains why they miss cache or blow allocations, and if you click benchmark it compiles real c++ on your machine (or shows premeasured reference data if you have no compiler). zero external runtime deps. no python sidecar. no network.

what it actually does

1. open a c++ file. parser lights up.
2. squiggly warnings with the "why this is slow" note.
3. click benchmark. clang++/g++ at O2, or the reference numbers if you cannot compile.
4. dashboard: pattern explorer, scaling charts.
5. optional: ai work advisor and regression triage. deterministic scoring, not vibes.

patterns it looks for (speedups are upper bounds on synthetic benches, large N, O2)

- std::map vs unordered_map: data structures, maybe 2-5x
- std::list vs vector: cache locality, maybe 5-20x
- push_back vs reserve + push_back: allocation, maybe 1.5-3x
- virtual dispatch vs crtp: 2-5x
- array of structs vs struct of arrays: 2-10x
- branchy vs branchless: 2-4x
- shared_ptr vs unique_ptr: 1.5-3x
- false sharing vs cacheline padding: 2-10x
- pass by value vs reference: 1.5-5x
- std::pow vs multiply: 5-20x
- std::endl vs \\n: 2-10x
- loop .size() vs hoisted: 1.2-2x |

run your own hardware if you want numbers you can defend.

install

```
code --install-extension extension/latencylens-0.2.0.vsix
```

vs code 1.85+. clang++ or g++ optional for live benches.

architecture, tired version: native c++ analyzer binary does the real work. treesitter wasm is the fallback. typescript is just the bridge into the editor and the webview. c++ analyzing c++. that was the point.

reliability extras that survived the hackathon: deterministic work advisor, regression triage, a ci guard on benchmark snapshots, workshop slides if you want to teach it.
