# LatencyLens - Elevator Pitch

---

## Devpost (under 200 chars)

C++ analyzing C++ inside VS Code. Native analysis engine, live compiled benchmarks, 20 anti-patterns detected. Not a linter. Not AI. Real cost, measured on your machine.

---

## Full Pitch

I've been on teams where we built stuff nobody actually cared about. Great idea, solid LinkedIn post, and then radio silence. Not a single commit after the demo. Not because anyone was lazy, just because it didn't matter to them. When something doesn't matter to you personally, you show up, ship the minimum, and move on. I decided I'd rather work on something niche but something I'm absolutely certain will have more impact long term, because it's something I'll actually build and ship to completion.

A friend told me to start coding out minimalistic examples of everything I learn, not just read about it. I tried it. Never looked back.

Around the same time I was helping classmates debug C++ assignments and their code was syntactically correct but it was basically Python in a C++ trench coat. Like yes, it compiles. But using C++ like that is like using an RPG as a walking stick. It technically does the job, you're just completely missing the point of having it.

So I asked myself honestly: do I actually know C++? I have projects, I passed a C++ interview. But I've never shipped C++ to production. I've never had my code reviewed by someone who could spot shortcomings past obvious syntax. Most interns don't either. They're all building dashboards and chatbots. You don't get to make those mistakes until way later in your career, and by then the habits are already set.

Taking CMPT 450 (Computer Architecture), I got to go deep into things like cache lines, false sharing, branch prediction, and stack vs heap allocation. That's where low latency actually lives. Not in clever syntax. Not in design patterns. In systems thinking, memory discipline, and performance skepticism.

Coming at it from both sides helped. Interview prep for roles that actually use C++ seriously got me into RAII, move semantics, object lifetimes, const-correctness. The architecture course got me into cache awareness and predictable performance. Both are necessary. Neither one alone is enough, and neither of them gets taught together anywhere I've found.

The problem is accessible resources for this are terrible. Generic C++ tutorials never mention performance costs. YouTube clickbait titles promise low latency content but spend 40 minutes explaining syntax. University lectures, including ones I've sat in, will have students writing linked list traversals with std::list without mentioning the cache miss on every single node. And the code that gets written, reviewed by nobody who would catch it, gets shipped.

You can ask Copilot to optimize your C++. It'll give you something. But ask yourself, the next time you write similar code, will you remember the fix it gave you? Probably not. You got the answer without the understanding, and that gap follows you.

That's the problem LatencyLens is built around.

---

### What It Actually Does

LatencyLens is a VS Code extension that catches C++ performance anti-patterns as you write, explains exactly why each one costs you, and proves it by compiling and running real benchmarks on your machine.

The core analysis engine is itself written in C++. C++ analyzing C++. It compiles to a native binary on your machine with -O2, runs the detection in a single pass, and returns results in milliseconds. The extension invokes it as a subprocess and merges the detection results with explanations and benchmark data. If no compiler is available, it falls back to tree-sitter WASM, then to regex. Three tiers. Always works.

Not estimates. Not simulations. Actual compiled C++ with clang++ or g++, measured in nanoseconds.

When it catches something it underlines it directly in your editor, like a spell checker, except instead of typos it's watching for things like:

- std::list where std::vector would be 5 to 20 times faster due to cache misses on every node
- forgetting to call reserve before a push_back loop, causing repeated heap reallocations
- shared_ptr with reference counting overhead where unique_ptr would be enough
- two atomic counters on the same cache line causing false sharing across threads
- virtual dispatch in hot loops where the vtable indirection kills branch prediction

It uses tree-sitter to parse real AST, not regex. So it doesn't just flag every std::map. It checks whether you're actually using ordered traversal before suggesting you switch. It understands code structure, not just text patterns.

---

### The Benchmarks

Click the benchmark button above any detected pattern. It compiles a real C++ program on your machine with -O2 and measures the before and after in an interactive chart.

Numbers from the reference benchmarks:

| Pattern | Speedup |
|---------|---------|
| list to vector | 5 to 20x |
| std::pow to multiply | 5 to 20x |
| false sharing fix | 2 to 10x |
| AoS to SoA | 2 to 10x |
| map to unordered_map | 2 to 5x |
| virtual to CRTP | 2 to 5x |

These are upper bounds on synthetic benchmarks at large N with -O2. That's intentional. The tool tells you that. Run it on your own hardware and see the actual number. That's the point.

No compiler available? It falls back to pre-measured reference data and labels it clearly so you always know which one you're looking at. No fake numbers.

---

### The FAHH

When an error triggers? You hear it. The FAHH sound. Because some mistakes deserve a reaction and silent warnings are too easy to ignore.

---

### How It Is Different From Just Using Copilot

The obvious counter is: why not just ask Copilot to review your C++? You can. But that optimizes for getting the right answer, not for building the mental model. There's a difference between being told a fact and understanding it well enough to catch it yourself the next time.

LatencyLens is not trying to fix your code for you. It flags the pattern, tells you what the cost is structurally, explains the cache or allocation or synchronization reason behind it, and then shows you the measured nanosecond difference on your own hardware. That feedback loop, seeing the number, not being told the number, is what builds the instinct.

You can toggle it off entirely when you want to lock in and recall things yourself, and turn it back on when you want a full code review pass. The point is to build the habit, not to create a dependency.

---

### This Is a Real Problem

Watch any new grad C++ interview clip online. The ones who say they want to go into quant and write they know C++ on their resume. The interviewer asks about cache locality or move semantics or what happens when you copy a vector and the answer falls apart. It's not because they're not smart. It's because the resources they learned from never talked about it.

STL abuse without cost awareness is not just a bad habit. In production systems it's a correctness issue in the sense that latency guarantees become unpredictable. And nobody is teaching this in a way that makes it stick before you're three years into your career.

The gap between syntactically correct C++ and production quality C++ is huge, and there is almost nothing between a beginner tutorial and a paper on the LMAX Disruptor architecture. LatencyLens is trying to live in that gap and make it navigable.

---

### Why This One

12 patterns detected. Live inline diagnostics. Real compiled benchmarks. Interactive scaling charts. Tree-sitter AST parsing. Dual-mode benchmark runner. Zero external dependencies.

No Python. No server. No pip install. Install the .vsix, open a .cpp file, and LatencyLens starts running immediately.

This isn't a prototype. It's installable right now. I use it. I'm iterating on it past this weekend. The commit history will reflect that. I didn't build this to win a hackathon. I built it because I kept running into the problem and nothing that existed solved it the way I wanted.

---

### Live Demo

Open the demo site, paste or write your own C++ code, and see what it flags. Or install the extension and run it on your own files directly. Judges can do either.

The sample file the extension ships with is a C++ file with intentional anti-patterns seeded across it. Every single one gets flagged. Click any of them to see the structural reason it's slow and the measured before and after in an interactive chart.

---

### The Actual Problem Statement

Low latency C++ is not about syntax. It's about systems thinking, memory discipline, and performance skepticism. That's hard to learn from tutorials that never measure anything. Hard to learn from code reviews you never get as an intern. Hard to internalize from a textbook.

You learn it by seeing the numbers. You remember it when you felt the difference yourself. LatencyLens makes that loop immediate, inside the editor you're already in, without installing anything.

That is the real problem. This is a working solution to it.

---

### What Makes the AST Approach Worth Mentioning

Most pattern detection tools use regex. Regex matches text. It does not know that the std::map you're flagging is actually doing an ordered traversal and unordered_map would break your logic. It does not know that the push_back you're warning about already has a reserve call three lines above it.

LatencyLens uses tree-sitter, which parses real syntax trees. The same parser used in GitHub's code search. The detector for push_back without reserve walks up the call graph to check whether reserve was called earlier in the same scope. The map detector checks whether the code uses any ordering operations on the container before flagging. The false sharing detector checks whether two atomics are declared adjacent in the same struct with no padding between them.

That matters because false positives in a diagnostic tool are worse than silence. You stop reading the warnings.

---

### What Is Next

The patterns already implemented cover the most common and highest impact cases. The benchmark infrastructure is built. The AST detection pipeline is built. Extending it to new patterns is a matter of writing the detection logic and the benchmark code, not rebuilding plumbing.

Next on the list is deeper scaling analysis: showing how a pattern's cost grows with input size using a chart that maps nanoseconds against N, so you can see not just that something is slower but how much worse it gets under load. That is already in the dashboard as a chart component, the dynamic version with live benchmark data is the next iteration.

---

