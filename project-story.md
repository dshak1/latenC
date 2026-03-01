# LatencyLens — Project Story

---

## Inspiration

A friend told me to start coding out minimalistic examples of everything I learn, not just read about it. I tried it and never looked back. That habit of writing the code, running it, feeling the difference, is what actually builds the mental model. Reading about cache misses is different from running a benchmark and watching a linked list iteration be 20 times slower than a vector on the same data.

Around the same time I was helping classmates debug C++ assignments. Their code was syntactically correct. It compiled. It ran. But it was basically Python in a C++ trench coat. Using std::list for sequential data, std::map when ordering was never needed, shared_ptr everywhere because that's what tutorials showed. Like yes, technically fine for getting marks in a course. But using C++ that way is like using an RPG as a walking stick. You're completely missing the point of having it.

I asked myself honestly: do I actually know C++? I have projects, I passed a C++ interview, I have it on my resume. But I've never shipped C++ to production. I've never had my code reviewed by someone who catches performance issues past obvious syntax errors. Most interns, myself included, are building dashboards and chatbots. You don't get that kind of code review until way later in your career, if at all.

Taking CMPT 450 (Computer Architecture), I got to go deep into cache lines, false sharing, branch prediction, stack vs heap allocation, and Amdahl's law. That's where low latency actually lives. Not in clever syntax. Not in design patterns. In systems thinking, memory discipline, and performance skepticism. Those two things combined, interview prep that forced me into RAII, move semantics, and object lifetimes, and a computer architecture course that showed me the hardware side, gave me the full picture.

The problem is there's almost nothing that bridges these things for someone learning. Generic tutorials never mention performance costs. YouTube videos clickbait you with "low latency C++" and spend 40 minutes on syntax. University lectures will have students writing sequential traversals with std::list without mentioning the cache miss on every single pointer hop. And the code gets written, reviewed by nobody who would catch it, and nobody learns anything different next time.

You can ask Copilot to optimize your C++. It'll give you something. But ask yourself, the next time you write similar code, will you remember the fix? Probably not. You got the answer without the understanding and that gap follows you.

That's the problem LatencyLens is built to solve.

---

## What It Does

LatencyLens is a VS Code extension that catches C++ performance anti-patterns as you write, explains exactly why each one costs you, and proves it by compiling and running real benchmarks on your machine.

Not estimates. Not AI suggestions. Actual compiled C++ measured in nanoseconds.

It underlines issues directly in your editor, the same way a spell checker works, except instead of typos it's watching for things like:

- std::list where std::vector would be 5 to 20 times faster due to cache misses on every node pointer
- missing reserve before a push_back loop, causing repeated heap reallocations
- shared_ptr with atomic reference counting overhead where unique_ptr would be sufficient
- two atomic counters adjacent on the same cache line causing false sharing across threads
- virtual dispatch in hot loops where the vtable indirection breaks branch prediction
- std::endl flushing the buffer on every call when a newline would do
- std::pow for integer exponents when a multiply is 5 to 20 times faster

Click the benchmark button above any detected pattern. It compiles a real C++ program with clang++ or g++ at -O2, runs it, and shows the before and after in an interactive chart. If no compiler is on the machine, it falls back to pre-measured reference data and labels it clearly. No fake numbers, ever.

You can toggle the whole extension off when you want to work without it and back on when you want a performance review pass. The point is to build the instinct over time, not to create a dependency on being told the answer.

---

## How We Built It

The frontend is TypeScript running inside the VS Code extension host. No Python, no server, no pip install, no network calls. But the actual computation, the pattern detection and analysis, is a native C++ binary. C++ analyzing C++. That's the point.

**Core engine: native C++ analyzer (ll_analyzer)**

The analysis engine is a standalone C++ program compiled with clang++ -O2 -std=c++17. It reads a C++ source file (or stdin), runs 20 context-aware pattern detectors, and outputs detected findings as JSON to stdout. The extension invokes it as a subprocess via child_process.

The C++ analyzer handles all the structural analysis: comment stripping, brace-depth tracking for scope detection (is this push_back inside a loop?), variable tracking across lines (did this vector already get a reserve call?), and struct-level analysis (are these two atomics on the same cache line?). It runs in a single pass over the source and returns in milliseconds. The detection logic understands context because it tracks scope, not just text.

If the C++ binary is not compiled yet (first install), the extension auto-compiles it from source using whatever C++ compiler is on the machine. If no compiler is available at all, it falls back to tree-sitter WASM analysis in TypeScript, then to enhanced regex. Three tiers of fallback, always graceful degradation.

**Tree-sitter fallback: WebAssembly**

The secondary analysis path uses web-tree-sitter compiled to WASM with the tree-sitter-cpp grammar. This gives real AST parsing when the native binary is unavailable. Same detection logic, different implementation language. There's also a regex fallback below that for environments where even the WASM fails to load.

**Benchmarks: dual-mode runner**

The benchmark runner uses Node's child_process to invoke clang++ or g++ with -O2 -std=c++17 -march=native, writes a temporary file, compiles it, runs it, parses stdout for nanosecond timings, and returns the result. When no compiler is found it returns pre-measured reference data, always labeled as reference data so you always know which one you got.

Results are shown in Chart.js-powered charts inside a VS Code Webview panel. The webview communicates with the extension host via postMessage, no HTTP, no localhost server.

**Patterns: 12 implemented, AST-aware**

Each pattern has a detection function, an explanation of the underlying hardware or allocation reason, before and after code snippets, a full self-contained C++ benchmark program, and a reference measurement. The pattern library is structured so adding a new one is just filling in the interface, the detection pipeline and benchmark runner pick it up automatically.

**The FAHH**

When you hit an error, you hear it. A sound effect fires on diagnostic triggers. Some mistakes deserve a reaction.

---

## Challenges

Building the native C++ analyzer required solving the same problems the extension is designed to teach. Writing the scope tracker with brace-depth tracking, making the comment stripper handle block comments and trailing inline comments correctly, getting the reserve-pattern detector to ignore reserve calls that only exist inside comments. I kept running into my own anti-patterns while building the tool that detects them.

Getting tree-sitter WASM to run inside a VS Code extension host as a fallback was another hurdle. The WASM initialization path is specific and the extension host sandbox has constraints around file paths and module loading. Getting the locateFile configuration right so the parser could find tree-sitter.wasm reliably across different OS environments took iteration.

The auto-compilation of the C++ binary on first install had to handle all the edge cases: different compilers on different platforms, machines with no compiler at all, and the fallback chain when compilation fails.

Writing benchmark code that produces stable, reproducible nanosecond measurements (preventing compiler optimizations from eliminating the thing you're trying to measure, using volatile sinks, using chrono with appropriate granularity) is its own problem. Getting numbers that match real-world intuition without being misleading took several rounds of iteration.

---

## Accomplishments

It works. That's the actual one. The extension is installable from the marketplace today, it runs on a real C++ file, it finds real issues, it explains them correctly, and when you click benchmark it runs real compiled code on your hardware and shows you the actual number.

The AST-based detection catches patterns that regex would miss or would misfire on. The dual-mode benchmark runner means it's useful on any machine, with or without a compiler. The toggle means it doesn't get in the way when you want to lock in and think for yourself.

---

## What We Learned

Low latency C++ is not a syntax problem and it's not something you learn from a checklist. It's a set of instincts about where cost lives that you build through feedback over time. The thing that makes feedback stick is immediacy, seeing the nanosecond number right now in the file you're already writing, not reading about it in a tutorial later.

Building the AST analysis pipeline also reinforced exactly the point the extension is trying to make. Context matters. Text matching is local and brittle. Structural understanding of code requires treating it as a tree, not a string, and that applies to how you reason about your own code too.

---

## What's Next

The patterns currently implemented cover the highest impact common cases. The infrastructure for adding more is already built. Next is dynamic scaling analysis, charting nanoseconds against input size N so you can see not just that a pattern is slower but how much worse it gets under load. The chart component is already in the dashboard, the live benchmark data feeding it is the next iteration.

Ongoing error monitoring with aggregated reports across a codebase (how often each pattern appears, which files have the most issues, how the pattern distribution changes over time) is also on the list. The pattern detection runs on every save, the data just needs somewhere to go.

---

## Built With

- C++17 (native analysis engine, benchmark programs, chrono timing)
- clang++ / g++ (compiles the analyzer and live benchmarks)
- TypeScript (VS Code extension frontend, UI, bridge layer)
- VS Code Extension API (diagnostics, CodeLens, commands, configuration)
- VS Code Webview API (dashboard panel, postMessage communication)
- web-tree-sitter / WebAssembly (fallback AST parser)
- tree-sitter-cpp grammar (WASM fallback)
- Chart.js (dashboard visualizations)
- Node.js child_process (native binary and compiler invocation)
