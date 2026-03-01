# LatencyLens

## The Problem

I have been in hackathon groups where we built things nobody cared about.
The idea looked great on a slide. Got the LinkedIn post. Got some claps.
Then never a single commit again after the event. Because it did not matter to anyone.

I decided to do something different. Something niche. Something I am absolutely certain
will have more impact in the long run, because it is something I will build, ship, and
keep using past this weekend.

---

## Where It Comes From

A friend of mine gave me the best advice I have gotten about learning:
code out a minimalistic working example of everything you learn. I tried it, I never looked back.

But then I was helping classmates with a C++ assignment and I saw something that changed how I
thought about this whole space.

Their code worked. It compiled. It passed the test cases. But it looked like Python with semicolons.

Things like this:

```cpp
std::list<double> measurements;  // iterates 100k nodes, cache miss on every single one
std::map<int, std::string> cache; // O(log n) per lookup when you just need a hash
std::shared_ptr<Shape> s = std::make_shared<Shape>(); // reference counting overhead for no reason
```

Syntax-correct. Semantically valid. And quietly burning cycles in ways that would never
get caught in a course assignment but would get absolutely roasted in a real code review.

It is like using an RPG as a walking stick. Technically it holds you up.

---

## I Asked Myself If I Even Knew C++

I had projects. I passed a C++ interview. But I had never shipped C++ production code.
Never had my C++ reviewed by a senior who could catch things past syntax.

So I started going deeper. Interview prep got me into object lifetimes, RAII, move semantics,
const-correctness, references vs pointers. Then CMPT 450, Computer Architecture, gave me
the framework I was missing: cache lines, false sharing, alignment, branch prediction, memory discipline.

That is where low latency actually lives. Not in syntax. Not in design patterns. In systems thinking,
memory discipline, and performance skepticism.

And here is the thing: there is no good resource for this at the student level.

Generic C++ tutorials never mention it. University lectures do not cover it. YouTube clickbait
titles "10x Your C++ Performance" and then shows you to use auto. Most interns never even
touch this because production low-latency systems are too risky to let new grads anywhere
near. You only get the feedback from a senior ten years into your career, if you're lucky.

You could ask Copilot. But ask yourself honestly, when Copilot rewrites your loop to use
reserve(), how much of that do you actually retain? When you write the same loop next week,
do you remember why? No. Because you did not do it.

---

## What LatencyLens Does

LatencyLens is a VS Code extension that gives you that senior code review, in real time,
while you are writing C++.

It parses your code with a tree-sitter AST parser running entirely in WebAssembly inside VS Code.
No Python. No server. No pip install. You install the .vsix and it works.

It detects 12 C++ performance anti-patterns with proper contextual analysis:

- std::map where you do not need ordering, when unordered_map is O(1) average vs O(log n)
- std::list for sequential access, where you get a cache miss on every single node traversal
- push_back in a loop without a preceding reserve, causing repeated heap reallocations
- shared_ptr where unique_ptr is sufficient, paying atomic reference counting for nothing
- Adjacent atomics on the same cache line causing false sharing across threads
- Virtual dispatch in performance-critical paths where the vtable indirection matters
- Large objects passed by value instead of reference
- std::endl forcing a buffer flush where backslash n would not
- std::pow for small integer exponents instead of direct multiplication
- Branchable conditionals that can be replaced with branchless arithmetic
- Loop conditions calling .size() on every iteration
- Array-of-structs layouts that would benefit from struct-of-arrays for SIMD

When it finds something, you get an inline squiggly warning right on the line.
Above the pattern, a CodeLens button reads "Benchmark this". You click it.

It compiles a real C++ benchmark with your local clang++ or g++, runs it, and shows you
the actual measured difference in a Chart.js chart in the dashboard. Not a toy estimate.
A real compiled binary running on your machine.

If you do not have a compiler, it falls back to pre-measured reference data, honestly labeled.
But on a machine with clang++ you are looking at live numbers.

The dashboard also shows you scaling charts: how the pattern gets worse as input size grows,
so you can see the difference between O(n) cache-friendly traversal and O(n) with pointer
chasing. The kind of thing Amdahl's law makes visible in computer architecture class but
that nobody shows you in code.

---

## This Is Not a Prototype

You can install this right now from the .vsix. It activates automatically on any .cpp file.
The AST-based detection is context-aware, meaning it checks whether reserve was actually
called before the loop, not just whether the word exists in the file.

I am not here to show you a mockup of a feature I plan to build. This is working software
that I use, that I am iterating on, and that I intend to expand past this hackathon.

---

## For the Demo

Pull up sample.cpp. It has six of the twelve patterns in it: map, list, no reserve, shared_ptr,
false sharing, and virtual dispatch in a loop. Every one gets flagged inline.

Click any CodeLens benchmark. Watch it compile and run. See the chart.

Then write your own code live and watch LatencyLens catch it in real time.

---

## Why This Is Dr. Jekyll

This is not chaos. This is not a shitpost.

This is a specific, real problem that affects every CS student trying to get good at C++
without a senior engineer over their shoulder. I felt it myself. I built the thing to solve it.
And it works.

Low latency C++ is in demand. The gap between what students learn and what the job requires
is real. LatencyLens does not close that gap by doing the work for you.
It shows you exactly where your thinking is off, and forces you to understand why.
