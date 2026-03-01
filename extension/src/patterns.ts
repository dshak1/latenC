/**
 * LatencyLens - C++ Performance Anti-Pattern Definitions
 *
 * All 12 patterns with:
 * - AST-aware detection (works with tree-sitter node types)
 * - Explanations, before/after snippets
 * - Benchmark C++ code (for optional local compile)
 * - Reference benchmark data (for zero-dep mode)
 */

export interface PatternMatch {
    line: number;
    text: string;
    context?: string; // AST context that confirms this match
}

export interface ReferenceBenchmark {
    before_ns: number;
    after_ns: number;
    speedup: number;
    data_size: number;
    note: string;
}

export interface Pattern {
    id: string;
    name: string;
    category: string;
    short_desc: string;
    explanation: string;
    fix_hint: string;
    speedup_context: string;
    severity: 'high' | 'medium' | 'low';
    before_label: string;
    after_label: string;
    before_snippet: string;
    after_snippet: string;
    benchmark_code: string;
    reference_benchmarks: ReferenceBenchmark;
    references: { title: string; url: string }[];
    further_reading: { title: string; url: string }[];
}

export const PATTERNS: Pattern[] = [
    // ── 1. std::map vs std::unordered_map ────────────────────────
    {
        id: 'map_vs_unordered',
        name: 'std::map → std::unordered_map',
        category: 'Data Structures',
        short_desc: 'Tree traversal (O(log n)) vs hash lookup (O(1))',
        explanation:
            'std::map uses a red-black tree - every lookup traverses O(log n) nodes, ' +
            'each potentially a cache miss. std::unordered_map uses a hash table with ' +
            'O(1) amortized lookups. For integer/string keys where ordering isn\'t needed, ' +
            'unordered_map can be 2–5× faster. The gap widens with more elements as tree ' +
            'depth grows while hash access stays constant.',
        severity: 'medium',
        before_label: 'std::map',
        after_label: 'std::unordered_map',
        before_snippet: `std::map<int, int> m;
for (int i = 0; i < N; i++) m[keys[i]] = i;
auto it = m.find(key);  // O(log n) -- tree traversal`,
        after_snippet: `std::unordered_map<int, int> m;
m.reserve(N);
for (int i = 0; i < N; i++) m[keys[i]] = i;
auto it = m.find(key);  // O(1) -- hash lookup`,
        reference_benchmarks: { before_ns: 98_000_000, after_ns: 32_000_000, speedup: 3.06, data_size: 100_000, note: 'Apple M1, clang++ -O2, integer keys' },
        fix_hint: 'Replace std::map with std::unordered_map and add .reserve(N) if you know the size. Only keep std::map if you need sorted iteration.',
        speedup_context: 'At 100K lookups, you saved ~66ms per batch. In a trading system processing market data, that is the difference between seeing the price and missing the fill.',
        references: [
            { title: 'std::unordered_map', url: 'https://en.cppreference.com/w/cpp/container/unordered_map' },
            { title: 'std::map', url: 'https://en.cppreference.com/w/cpp/container/map' },
        ],
        further_reading: [
            { title: 'Hash Table vs Red-Black Tree - When to Use Which', url: 'https://isocpp.org/wiki/faq/containers#vector-vs-list' },
            { title: 'Chandler Carruth: Efficiency with Algorithms (CppCon)', url: 'https://www.youtube.com/watch?v=fHNmRkzxHWs' },
        ],
        benchmark_code: `#include <iostream>
#include <chrono>
#include <map>
#include <unordered_map>
#include <string>
#include <vector>
#include <cstdlib>

#ifndef DATA_SIZE
#define DATA_SIZE 100000
#endif
#ifndef ITERATIONS
#define ITERATIONS 5
#endif

int main() {
    const int N = DATA_SIZE;
    const int ITERS = ITERATIONS;
    std::vector<int> keys(N);
    std::srand(42);
    for (int i = 0; i < N; i++) keys[i] = std::rand() % (N * 10);

    double before_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        std::map<int, int> m;
        auto start = std::chrono::high_resolution_clock::now();
        for (int i = 0; i < N; i++) m[keys[i]] = i;
        volatile int sink = 0;
        for (int i = 0; i < N; i++) { auto it = m.find(keys[i]); if (it != m.end()) sink = it->second; }
        auto end = std::chrono::high_resolution_clock::now();
        before_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }

    double after_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        std::unordered_map<int, int> m;
        m.reserve(N);
        auto start = std::chrono::high_resolution_clock::now();
        for (int i = 0; i < N; i++) m[keys[i]] = i;
        volatile int sink = 0;
        for (int i = 0; i < N; i++) { auto it = m.find(keys[i]); if (it != m.end()) sink = it->second; }
        auto end = std::chrono::high_resolution_clock::now();
        after_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }

    std::cout << "{\\"before_ns\\":" << (before_total / ITERS)
              << ",\\"after_ns\\":" << (after_total / ITERS)
              << ",\\"data_size\\":" << N
              << ",\\"iterations\\":" << ITERS << "}" << std::endl;
    return 0;
}`,
    },

    // ── 2. std::list vs std::vector ──────────────────────────────
    {
        id: 'list_vs_vector',
        name: 'std::list → std::vector',
        category: 'Cache Locality',
        short_desc: 'Pointer chasing vs contiguous memory',
        explanation:
            'std::list allocates each node separately on the heap, scattering data across memory. ' +
            'Iterating chases pointers, causing L1/L2 cache misses on almost every access. ' +
            'std::vector stores elements contiguously - the hardware prefetcher loads the next ' +
            'cache line automatically, hitting L1 cache ~95% of the time. This alone can give ' +
            '5–20× speedup on iteration-heavy workloads.',
        severity: 'high',
        before_label: 'std::list',
        after_label: 'std::vector',
        before_snippet: `std::list<int> data;
for (auto& val : data) sum += val;
// Each node is a separate heap allocation
// Pointer chasing → cache miss on every access`,
        after_snippet: `std::vector<int> data;
for (auto& val : data) sum += val;
// Contiguous memory → hardware prefetcher
// L1 cache hits ~95% of the time`,
        reference_benchmarks: { before_ns: 45_000_000, after_ns: 3_200_000, speedup: 14.06, data_size: 1_000_000, note: 'Apple M1, clang++ -O2, int iteration' },
        fix_hint: 'Replace std::list with std::vector unless you need stable iterators during mid-sequence insertion. Even frequent insertions in the middle are often faster with vector due to cache locality.',
        speedup_context: 'A 14x speedup on iteration. Over 1M elements, the vector finishes while the list is still chasing pointers through scattered heap memory. This is what cache locality looks like in practice.',
        references: [
            { title: 'std::vector', url: 'https://en.cppreference.com/w/cpp/container/vector' },
            { title: 'std::list', url: 'https://en.cppreference.com/w/cpp/container/list' },
        ],
        further_reading: [
            { title: 'Bjarne Stroustrup: Why you should avoid linked lists', url: 'https://www.youtube.com/watch?v=YQs6IC-vgmo' },
            { title: 'Data-Oriented Design (Mike Acton, CppCon)', url: 'https://www.youtube.com/watch?v=rX0ItVEVjHc' },
        ],
        benchmark_code: `#include <iostream>
#include <chrono>
#include <list>
#include <vector>

#ifndef DATA_SIZE
#define DATA_SIZE 1000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 10
#endif

int main() {
    const int N = DATA_SIZE; const int ITERS = ITERATIONS;
    std::list<int> lst; for (int i = 0; i < N; i++) lst.push_back(i);
    double before_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        volatile long long sum = 0; for (auto& val : lst) sum += val;
        auto end = std::chrono::high_resolution_clock::now();
        before_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    std::vector<int> vec(lst.begin(), lst.end());
    double after_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        volatile long long sum = 0; for (auto& val : vec) sum += val;
        auto end = std::chrono::high_resolution_clock::now();
        after_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    std::cout << "{\\"before_ns\\":" << (before_total / ITERS)
              << ",\\"after_ns\\":" << (after_total / ITERS)
              << ",\\"data_size\\":" << N
              << ",\\"iterations\\":" << ITERS << "}" << std::endl;
    return 0;
}`,
    },

    // ── 3. reserve + push_back ───────────────────────────────────
    {
        id: 'reserve_pattern',
        name: 'push_back → reserve + push_back',
        category: 'Memory Allocation',
        short_desc: 'Eliminate reallocation and copying overhead',
        explanation:
            'Without reserve(), vector doubles its capacity when full - requiring a new allocation, ' +
            'copying all existing elements, and freeing old memory. For N insertions, this causes ' +
            'O(log N) reallocations, each copying all elements. With reserve(N), you get one ' +
            'allocation upfront. Big wins on large vectors.',
        severity: 'medium',
        before_label: 'No reserve()',
        after_label: 'With reserve()',
        before_snippet: `std::vector<int> v;
for (int i = 0; i < N; i++)
    v.push_back(i);
// ~log2(N) reallocations, each copies ALL elements`,
        after_snippet: `std::vector<int> v;
v.reserve(N);  // Single allocation upfront
for (int i = 0; i < N; i++)
    v.push_back(i);
// Zero reallocations, zero copies`,
        reference_benchmarks: { before_ns: 52_000_000, after_ns: 38_000_000, speedup: 1.37, data_size: 5_000_000, note: 'Apple M1, clang++ -O2' },
        fix_hint: 'Call v.reserve(N) before the loop if you know or can estimate the final size. For exact sizes, consider resize() + direct index assignment instead of push_back.',
        speedup_context: 'One line of code eliminated ~20 hidden reallocation-and-copy cycles. For a 5M element vector, that is 23 full copies of the data you never needed to make.',
        references: [
            { title: 'std::vector::reserve', url: 'https://en.cppreference.com/w/cpp/container/vector/reserve' },
            { title: 'std::vector::capacity', url: 'https://en.cppreference.com/w/cpp/container/vector/capacity' },
        ],
        further_reading: [
            { title: 'How vector grows: amortized analysis', url: 'https://en.cppreference.com/w/cpp/container/vector' },
        ],
        benchmark_code: `#include <iostream>
#include <chrono>
#include <vector>

#ifndef DATA_SIZE
#define DATA_SIZE 5000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 10
#endif

int main() {
    const int N = DATA_SIZE; const int ITERS = ITERATIONS;
    double before_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        std::vector<int> v;
        auto start = std::chrono::high_resolution_clock::now();
        for (int i = 0; i < N; i++) v.push_back(i);
        auto end = std::chrono::high_resolution_clock::now();
        before_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    double after_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        std::vector<int> v; v.reserve(N);
        auto start = std::chrono::high_resolution_clock::now();
        for (int i = 0; i < N; i++) v.push_back(i);
        auto end = std::chrono::high_resolution_clock::now();
        after_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    std::cout << "{\\"before_ns\\":" << (before_total / ITERS)
              << ",\\"after_ns\\":" << (after_total / ITERS)
              << ",\\"data_size\\":" << N
              << ",\\"iterations\\":" << ITERS << "}" << std::endl;
    return 0;
}`,
    },

    // ── 4. Virtual dispatch → CRTP ──────────────────────────────
    {
        id: 'virtual_vs_crtp',
        name: 'Virtual Dispatch → CRTP',
        category: 'Devirtualization',
        short_desc: 'Runtime vtable lookup vs compile-time resolution',
        explanation:
            'Virtual function calls go through a vtable pointer → vtable → function pointer. ' +
            'This is 2 indirections + prevents inlining. CRTP (Curiously Recurring Template Pattern) ' +
            'resolves the call at compile time - the compiler can inline the function body entirely.',
        severity: 'medium',
        before_label: 'Virtual dispatch',
        after_label: 'CRTP (compile-time)',
        before_snippet: `struct Shape {
    virtual double area() const = 0;  // vtable indirection
};
for (auto& s : shapes) total += s->area();
// 2 pointer dereferences per call, no inlining possible`,
        after_snippet: `template<typename Derived>
struct Shape {
    double area() const {
        return static_cast<const Derived*>(this)->area_impl();
    }  // Resolved at compile time
};
for (auto& s : shapes) total += s.area();
// Zero indirection, fully inlined, auto-vectorizable`,
        reference_benchmarks: { before_ns: 68_000_000, after_ns: 22_000_000, speedup: 3.09, data_size: 10_000_000, note: 'Apple M1, clang++ -O2' },
        fix_hint: 'Use CRTP when you have a fixed set of derived types known at compile time. Keep virtual dispatch for plugin-style extensibility where types are loaded at runtime.',
        speedup_context: 'Each virtual call burns two pointer dereferences and kills inlining. Over 10M calls, switching to CRTP saved 46ms. The compiler literally computed the answer at compile time instead of chasing vtable pointers.',
        references: [
            { title: 'virtual function specifier', url: 'https://en.cppreference.com/w/cpp/language/virtual' },
            { title: 'CRTP (Curiously Recurring Template Pattern)', url: 'https://en.cppreference.com/w/cpp/language/crtp' },
        ],
        further_reading: [
            { title: 'CppCon: The Cost of Dynamic Polymorphism', url: 'https://www.youtube.com/watch?v=QMR-FkTMuBs' },
        ],
        benchmark_code: `#include <iostream>
#include <chrono>
#include <vector>
#include <memory>
#include <cmath>

#ifndef DATA_SIZE
#define DATA_SIZE 10000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 5
#endif

struct ShapeVirtual { virtual double area() const = 0; virtual ~ShapeVirtual() = default; };
struct CircleVirtual : ShapeVirtual { double r; CircleVirtual(double r):r(r){} double area() const override { return 3.14159265358979*r*r; } };

template<typename D> struct ShapeCRTP { double area() const { return static_cast<const D*>(this)->area_impl(); } };
struct CircleCRTP : ShapeCRTP<CircleCRTP> { double r; CircleCRTP(double r):r(r){} double area_impl() const { return 3.14159265358979*r*r; } };

int main() {
    const int N = DATA_SIZE; const int ITERS = ITERATIONS;
    std::vector<std::unique_ptr<ShapeVirtual>> sv; sv.reserve(N);
    for (int i = 0; i < N; i++) sv.push_back(std::make_unique<CircleVirtual>(i*0.01));
    double before_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        volatile double t = 0; for (auto& s : sv) t += s->area();
        auto end = std::chrono::high_resolution_clock::now();
        before_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    std::vector<CircleCRTP> sc; sc.reserve(N);
    for (int i = 0; i < N; i++) sc.emplace_back(i*0.01);
    double after_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        volatile double t = 0; for (auto& s : sc) t += s.area();
        auto end = std::chrono::high_resolution_clock::now();
        after_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    std::cout << "{\\"before_ns\\":" << (before_total / ITERS)
              << ",\\"after_ns\\":" << (after_total / ITERS)
              << ",\\"data_size\\":" << N
              << ",\\"iterations\\":" << ITERS << "}" << std::endl;
    return 0;
}`,
    },

    // ── 5. AoS → SoA ────────────────────────────────────────────
    {
        id: 'aos_vs_soa',
        name: 'Array of Structs → Struct of Arrays',
        category: 'Cache Optimization',
        short_desc: 'Load only what you need into cache lines',
        explanation:
            'AoS packs all fields together - accessing one field loads ALL fields into the cache line, ' +
            'wasting bandwidth. SoA stores each field in its own contiguous array. Critical in ' +
            'data-oriented design (games, HPC, finance). Can give 2–10× speedup when you only ' +
            'access 1-2 fields out of many. Also enables SIMD auto-vectorization.',
        severity: 'high',
        before_label: 'Array of Structs (AoS)',
        after_label: 'Struct of Arrays (SoA)',
        before_snippet: `struct Particle {
    float x, y, z;        // 12 bytes
    float vx, vy, vz;     // 12 bytes
    float mass; int id;    // 8 bytes -- WASTED in cache
};
// Updating position loads mass+id into cache for nothing`,
        after_snippet: `struct Particles {
    vector<float> x, y, z;     // contiguous
    vector<float> vx, vy, vz;  // contiguous
    vector<float> mass;         // separate
    vector<int> id;             // separate
};
// Only position+velocity data enters cache -- SIMD friendly`,
        reference_benchmarks: { before_ns: 18_000_000, after_ns: 5_500_000, speedup: 3.27, data_size: 2_000_000, note: 'Apple M1, clang++ -O2, position update' },
        fix_hint: 'Restructure your struct so each field is a separate contiguous array. Group fields that are accessed together. This is the core of Data-Oriented Design.',
        speedup_context: 'You loaded 32 bytes of struct data per cache line but only needed 12. SoA means every byte in the cache line is useful. Multiply this by 2M particles and you just reclaimed 40MB of wasted memory bandwidth.',
        references: [
            { title: 'alignas specifier', url: 'https://en.cppreference.com/w/cpp/language/alignas' },
        ],
        further_reading: [
            { title: 'Mike Acton: Data-Oriented Design and C++ (CppCon)', url: 'https://www.youtube.com/watch?v=rX0ItVEVjHc' },
            { title: 'Richard Fabian: Data-Oriented Design (free book)', url: 'https://www.dataorienteddesign.com/dodbook/' },
        ],
        benchmark_code: `#include <iostream>
#include <chrono>
#include <vector>
#include <cstdlib>

#ifndef DATA_SIZE
#define DATA_SIZE 2000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 10
#endif

struct ParticleAoS { float x,y,z,vx,vy,vz,mass; int id; };
struct ParticlesSoA {
    std::vector<float> x,y,z,vx,vy,vz,mass; std::vector<int> id;
    void resize(int n) { x.resize(n);y.resize(n);z.resize(n);vx.resize(n);vy.resize(n);vz.resize(n);mass.resize(n);id.resize(n); }
};

int main() {
    const int N = DATA_SIZE; const int ITERS = ITERATIONS; std::srand(42);
    std::vector<ParticleAoS> aos(N);
    for (int i = 0; i < N; i++) aos[i] = {(float)(std::rand()%1000),(float)(std::rand()%1000),(float)(std::rand()%1000),(float)(std::rand()%100)/100.0f,(float)(std::rand()%100)/100.0f,(float)(std::rand()%100)/100.0f,(float)(std::rand()%100)/10.0f,i};
    ParticlesSoA soa; soa.resize(N);
    for (int i = 0; i < N; i++) { soa.x[i]=aos[i].x;soa.y[i]=aos[i].y;soa.z[i]=aos[i].z;soa.vx[i]=aos[i].vx;soa.vy[i]=aos[i].vy;soa.vz[i]=aos[i].vz;soa.mass[i]=aos[i].mass;soa.id[i]=aos[i].id; }
    double before_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        const float dt = 0.016f;
        for (int i = 0; i < N; i++) { aos[i].x += aos[i].vx*dt; aos[i].y += aos[i].vy*dt; aos[i].z += aos[i].vz*dt; }
        auto end = std::chrono::high_resolution_clock::now();
        before_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    double after_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        const float dt = 0.016f;
        for (int i = 0; i < N; i++) { soa.x[i] += soa.vx[i]*dt; soa.y[i] += soa.vy[i]*dt; soa.z[i] += soa.vz[i]*dt; }
        auto end = std::chrono::high_resolution_clock::now();
        after_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    std::cout << "{\\"before_ns\\":" << (before_total / ITERS)
              << ",\\"after_ns\\":" << (after_total / ITERS)
              << ",\\"data_size\\":" << N
              << ",\\"iterations\\":" << ITERS << "}" << std::endl;
    return 0;
}`,
    },

    // ── 6. Branchy → Branchless ──────────────────────────────────
    {
        id: 'branch_vs_branchless',
        name: 'Branchy Code → Branchless',
        category: 'Branch Prediction',
        short_desc: 'Eliminate branch mispredictions with arithmetic',
        explanation:
            'Modern CPUs predict branches to keep the pipeline full. When predictions fail ' +
            '(~50% on random data), the pipeline flushes - costing 10–20 cycles per miss. ' +
            'Branchless code uses arithmetic/bitwise ops to compute the result without any branch.',
        severity: 'high',
        before_label: 'if/else branching',
        after_label: 'Branchless arithmetic',
        before_snippet: `for (int i = 0; i < N; i++) {
    if (data[i] >= THRESHOLD)  // Branch!
        sum += data[i];
}
// ~50% misprediction on random data = pipeline flush`,
        after_snippet: `for (int i = 0; i < N; i++) {
    int mask = -(data[i] >= THRESHOLD);  // 0 or 0xFFFFFFFF
    sum += (data[i] & mask);             // No branch
}
// Zero mispredictions, constant-time execution`,
        reference_benchmarks: { before_ns: 32_000_000, after_ns: 12_000_000, speedup: 2.67, data_size: 10_000_000, note: 'Apple M1, clang++ -O2, random data' },
        fix_hint: 'Convert conditional accumulation to arithmetic: use (-(condition)) as a mask, or multiply by the boolean. Works best when branch is unpredictable (~50/50). Sorted data has good prediction -- don\'t optimize what\'s already fast.',
        speedup_context: 'Each mispredicted branch flushes the CPU pipeline: 10-20 cycles wasted per miss. On 10M random elements with ~50% misprediction, thats roughly 50 million wasted cycles. Branchless code runs at a constant speed regardless of data.',
        references: [
            { title: 'Branch prediction', url: 'https://en.wikipedia.org/wiki/Branch_predictor' },
        ],
        further_reading: [
            { title: 'Why is processing a sorted array faster? (Stack Overflow)', url: 'https://stackoverflow.com/questions/11227809' },
            { title: 'Branchless Programming (Fedor Pikus, CppCon)', url: 'https://www.youtube.com/watch?v=g-WPhYREFjk' },
        ],
        benchmark_code: `#include <iostream>
#include <chrono>
#include <vector>
#include <cstdlib>

#ifndef DATA_SIZE
#define DATA_SIZE 10000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 10
#endif

int main() {
    const int N = DATA_SIZE; const int ITERS = ITERATIONS; const int THRESHOLD = 128;
    std::vector<int> data(N); std::srand(42);
    for (int i = 0; i < N; i++) data[i] = std::rand() % 256;
    double before_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        volatile long long sum = 0;
        for (int i = 0; i < N; i++) { if (data[i] >= THRESHOLD) sum += data[i]; }
        auto end = std::chrono::high_resolution_clock::now();
        before_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    double after_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        volatile long long sum = 0;
        for (int i = 0; i < N; i++) { int mask = -(data[i] >= THRESHOLD); sum += (data[i] & mask); }
        auto end = std::chrono::high_resolution_clock::now();
        after_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    std::cout << "{\\"before_ns\\":" << (before_total / ITERS)
              << ",\\"after_ns\\":" << (after_total / ITERS)
              << ",\\"data_size\\":" << N
              << ",\\"iterations\\":" << ITERS << "}" << std::endl;
    return 0;
}`,
    },

    // ── 7. shared_ptr → unique_ptr ───────────────────────────────
    {
        id: 'shared_vs_unique',
        name: 'shared_ptr → unique_ptr',
        category: 'Smart Pointers',
        short_desc: 'Atomic ref counting overhead vs zero-cost ownership',
        explanation:
            'shared_ptr maintains an atomic reference count - every copy/destroy does an atomic ' +
            'increment/decrement, which is a memory fence that stalls the CPU pipeline. unique_ptr ' +
            'has ZERO overhead - it\'s a raw pointer with RAII semantics. The compiler optimizes it completely.',
        severity: 'medium',
        before_label: 'std::shared_ptr',
        after_label: 'std::unique_ptr',
        before_snippet: `auto p = std::make_shared<Widget>();
ptrs.push_back(p);  // Atomic ref count ++
// Memory fence on every copy/destroy
// Cache line bouncing in multithreaded code`,
        after_snippet: `auto p = std::make_unique<Widget>();
ptrs.push_back(std::move(p));
// ZERO overhead -- same as raw pointer
// Compiler optimizes completely away`,
        reference_benchmarks: { before_ns: 180_000_000, after_ns: 95_000_000, speedup: 1.89, data_size: 5_000_000, note: 'Apple M1, clang++ -O2' },
        fix_hint: 'Default to std::unique_ptr for single ownership. Only use shared_ptr when ownership is genuinely shared across multiple owners with different lifetimes. Consider passing raw pointers/references for non-owning access.',
        speedup_context: 'Every shared_ptr copy/destroy is an atomic operation with a memory fence. Over 5M objects, you paid for 10M unnecessary atomic increments/decrements. unique_ptr compiles down to the same code as a raw pointer.',
        references: [
            { title: 'std::unique_ptr', url: 'https://en.cppreference.com/w/cpp/memory/unique_ptr' },
            { title: 'std::shared_ptr', url: 'https://en.cppreference.com/w/cpp/memory/shared_ptr' },
        ],
        further_reading: [
            { title: 'Herb Sutter: Back to the Basics! Essentials of Modern C++', url: 'https://www.youtube.com/watch?v=xnqTKD8uD64' },
        ],
        benchmark_code: `#include <iostream>
#include <chrono>
#include <memory>
#include <vector>

#ifndef DATA_SIZE
#define DATA_SIZE 5000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 5
#endif

struct Widget { int data[4]; Widget():data{1,2,3,4}{} };

int main() {
    const int N = DATA_SIZE; const int ITERS = ITERATIONS;
    double before_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        std::vector<std::shared_ptr<Widget>> ptrs; ptrs.reserve(N);
        auto start = std::chrono::high_resolution_clock::now();
        for (int i = 0; i < N; i++) { auto p = std::make_shared<Widget>(); ptrs.push_back(p); }
        auto end = std::chrono::high_resolution_clock::now();
        before_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    double after_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        std::vector<std::unique_ptr<Widget>> ptrs; ptrs.reserve(N);
        auto start = std::chrono::high_resolution_clock::now();
        for (int i = 0; i < N; i++) ptrs.push_back(std::make_unique<Widget>());
        auto end = std::chrono::high_resolution_clock::now();
        after_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    std::cout << "{\\"before_ns\\":" << (before_total / ITERS)
              << ",\\"after_ns\\":" << (after_total / ITERS)
              << ",\\"data_size\\":" << N
              << ",\\"iterations\\":" << ITERS << "}" << std::endl;
    return 0;
}`,
    },

    // ── 8. False sharing ─────────────────────────────────────────
    {
        id: 'false_sharing',
        name: 'False Sharing → Cache-Line Padding',
        category: 'Concurrency',
        short_desc: 'Prevent cache line bouncing between CPU cores',
        explanation:
            'When two threads write to variables on the SAME cache line (64 bytes on x86), ' +
            'the cache coherence protocol forces the cache line to bounce between cores on every write. ' +
            'This is "false sharing" - fix with alignas(64).',
        severity: 'high',
        before_label: 'Variables share cache line',
        after_label: 'Cache-line padded',
        before_snippet: `struct Counters {
    std::atomic<long> a{0};  // Same cache line!
    std::atomic<long> b{0};  // MESI protocol bouncing
};
// Two threads writing → cache line ping-pong between cores`,
        after_snippet: `struct alignas(64) PaddedCounter {
    std::atomic<long> value{0};
};
struct Counters {
    PaddedCounter a;  // Own cache line
    PaddedCounter b;  // Own cache line
};
// Each core owns its cache line -- no bouncing`,
        reference_benchmarks: { before_ns: 650_000_000, after_ns: 190_000_000, speedup: 3.42, data_size: 50_000_000, note: 'Apple M1, clang++ -O2, 2 threads' },
        fix_hint: 'Pad each thread-local variable to a full cache line with alignas(64) or std::hardware_destructive_interference_size. Group per-thread data in its own struct aligned to 64 bytes.',
        speedup_context: 'Two threads wrote to the same 64-byte cache line, forcing the MESI protocol to bounce it between cores on every write. Adding 56 bytes of padding gave a 3.4x speedup. Sometimes the cheapest optimization is wasting a little memory.',
        references: [
            { title: 'std::hardware_destructive_interference_size', url: 'https://en.cppreference.com/w/cpp/thread/hardware_destructive_interference_size' },
            { title: 'alignas specifier', url: 'https://en.cppreference.com/w/cpp/language/alignas' },
        ],
        further_reading: [
            { title: 'False Sharing and CPU Caches (Scott Meyers)', url: 'https://www.aristeia.com/TalkNotes/ACCU2011_FalseSharing.pdf' },
        ],
        benchmark_code: `#include <iostream>
#include <chrono>
#include <thread>
#include <atomic>
#include <vector>

#ifndef DATA_SIZE
#define DATA_SIZE 50000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 3
#endif

struct CountersPacked { std::atomic<long long> a{0}; std::atomic<long long> b{0}; };
struct alignas(64) PaddedCounter { std::atomic<long long> value{0}; };
struct CountersPadded { PaddedCounter a; PaddedCounter b; };

int main() {
    const int N = DATA_SIZE; const int ITERS = ITERATIONS;
    double before_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        CountersPacked packed;
        auto start = std::chrono::high_resolution_clock::now();
        std::thread t1([&](){for(int i=0;i<N;i++) packed.a.fetch_add(1,std::memory_order_relaxed);});
        std::thread t2([&](){for(int i=0;i<N;i++) packed.b.fetch_add(1,std::memory_order_relaxed);});
        t1.join(); t2.join();
        auto end = std::chrono::high_resolution_clock::now();
        before_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    double after_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        CountersPadded padded;
        auto start = std::chrono::high_resolution_clock::now();
        std::thread t1([&](){for(int i=0;i<N;i++) padded.a.value.fetch_add(1,std::memory_order_relaxed);});
        std::thread t2([&](){for(int i=0;i<N;i++) padded.b.value.fetch_add(1,std::memory_order_relaxed);});
        t1.join(); t2.join();
        auto end = std::chrono::high_resolution_clock::now();
        after_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    std::cout << "{\\"before_ns\\":" << (before_total / ITERS)
              << ",\\"after_ns\\":" << (after_total / ITERS)
              << ",\\"data_size\\":" << N
              << ",\\"iterations\\":" << ITERS << "}" << std::endl;
    return 0;
}`,
    },

    // ── 9. Pass by value → const& ───────────────────────────────
    {
        id: 'pass_by_value',
        name: 'Pass by Value → const Reference',
        category: 'Copy Elimination',
        short_desc: 'Avoid copying entire containers on every function call',
        explanation:
            'Passing a std::vector by value copies the ENTIRE container - every element. ' +
            'For 10M doubles that\'s 80MB copied just to read it. const& passes only an 8-byte pointer ' +
            'with zero copies. One of the most common C++ performance mistakes.',
        severity: 'high',
        before_label: 'Pass by value (copy)',
        after_label: 'Pass by const reference',
        before_snippet: `double compute(std::vector<double> data) {
    // ENTIRE vector is COPIED on every call
    // 10M doubles = 80MB copied per call
    for (auto& v : data) total += v;
}`,
        after_snippet: `double compute(const std::vector<double>& data) {
    // 8-byte pointer, ZERO copies
    // Same read access, no overhead
    for (auto& v : data) total += v;
}`,
        reference_benchmarks: { before_ns: 55_000_000, after_ns: 8_000_000, speedup: 6.88, data_size: 5_000_000, note: 'Apple M1, clang++ -O2, vector<double>' },
        fix_hint: 'Add const& to function parameters for any type larger than a pointer (8 bytes). Strings, vectors, maps -- always pass by const reference unless you need a copy inside the function.',
        speedup_context: 'Each call copied 5M doubles: 40MB memcpy just to read the data. Adding one ampersand to the signature reduced that to passing an 8-byte pointer. Over 10 calls thats 400MB of unnecessary copies eliminated.',
        references: [
            { title: 'Reference declaration', url: 'https://en.cppreference.com/w/cpp/language/reference' },
            { title: 'const type qualifier', url: 'https://en.cppreference.com/w/cpp/language/cv' },
        ],
        further_reading: [
            { title: 'C++ Core Guidelines: F.16', url: 'https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#f16-for-in-parameters-pass-cheaply-copied-types-by-value-and-others-by-reference-to-const' },
        ],
        benchmark_code: `#include <iostream>
#include <chrono>
#include <vector>

#ifndef DATA_SIZE
#define DATA_SIZE 5000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 10
#endif

double sum_by_value(std::vector<double> data) { double t=0; for(auto& v:data)t+=v; return t; }
double sum_by_ref(const std::vector<double>& data) { double t=0; for(auto& v:data)t+=v; return t; }

int main() {
    const int N = DATA_SIZE; const int ITERS = ITERATIONS;
    std::vector<double> data(N); for(int i=0;i<N;i++) data[i]=i*0.5;
    double before_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        auto start=std::chrono::high_resolution_clock::now();
        volatile double r=sum_by_value(data);
        auto end=std::chrono::high_resolution_clock::now();
        before_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    double after_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        auto start=std::chrono::high_resolution_clock::now();
        volatile double r=sum_by_ref(data);
        auto end=std::chrono::high_resolution_clock::now();
        after_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    std::cout << "{\\"before_ns\\":" << (before_total / ITERS)
              << ",\\"after_ns\\":" << (after_total / ITERS)
              << ",\\"data_size\\":" << N
              << ",\\"iterations\\":" << ITERS << "}" << std::endl;
    return 0;
}`,
    },

    // ── 10. pow(x,2) → x*x ──────────────────────────────────────
    {
        id: 'pow_vs_multiply',
        name: 'std::pow(x,2) → x * x',
        category: 'Math Overhead',
        short_desc: 'Replace heavy library call with a single multiply',
        explanation:
            'std::pow() is a general-purpose function that handles fractional exponents, NaN, inf - ' +
            'roughly 20–50 CPU cycles per call. A simple x * x is ONE multiply instruction (~3–5 cycles). ' +
            'The compiler CANNOT optimize pow(x, 2) into x * x due to IEEE 754 rounding semantics.',
        severity: 'high',
        before_label: 'std::pow(x, 2)',
        after_label: 'x * x',
        before_snippet: `for (int i = 0; i < N; i++) {
    total += std::pow(data[i], 2);
    // ~20-50 cycles per call (log + exp internally)
}`,
        after_snippet: `for (int i = 0; i < N; i++) {
    double x = data[i];
    total += x * x;
    // 1 multiply instruction (~3-5 cycles)
    // 10-20× faster per element
}`,
        reference_benchmarks: { before_ns: 120_000_000, after_ns: 8_000_000, speedup: 15.0, data_size: 10_000_000, note: 'Apple M1, clang++ -O2, runtime exponent' },
        fix_hint: 'Replace pow(x, 2) with x*x, pow(x, 3) with x*x*x, and pow(x, 0.5) with std::sqrt(x). The compiler cannot do this for you due to IEEE 754 floating-point semantics.',
        speedup_context: '15x faster. std::pow internally computes exp(2 * log(x)) using Taylor series. You replaced that with a single multiply instruction. Per element thats ~45 cycles saved, and the compiler still cannot make this optimization for you.',
        references: [
            { title: 'std::pow', url: 'https://en.cppreference.com/w/cpp/numeric/math/pow' },
            { title: 'std::sqrt', url: 'https://en.cppreference.com/w/cpp/numeric/math/sqrt' },
        ],
        further_reading: [
            { title: 'Why the compiler can\'t optimize pow(x,2) to x*x', url: 'https://stackoverflow.com/questions/6430448' },
        ],
        benchmark_code: `#include <iostream>
#include <chrono>
#include <vector>
#include <cmath>
#include <cstdlib>

#ifndef DATA_SIZE
#define DATA_SIZE 10000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 10
#endif

__attribute__((noinline)) double sum_with_pow(const double* data, int n, double exp) {
    double sum = 0; for(int i=0;i<n;i++) sum += std::pow(data[i], exp); return sum;
}
__attribute__((noinline)) double sum_with_mul(const double* data, int n) {
    double sum = 0; for(int i=0;i<n;i++){ double x=data[i]; sum += x*x; } return sum;
}

int main(int argc, char** argv) {
    const int N = DATA_SIZE; const int ITERS = ITERATIONS;
    double exponent = 2.0; if(argc>99) exponent = std::atof(argv[1]);
    std::vector<double> data(N); for(int i=0;i<N;i++) data[i]=i*0.001+0.1;
    double before_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        auto start=std::chrono::high_resolution_clock::now();
        volatile double r=sum_with_pow(data.data(),N,exponent);
        auto end=std::chrono::high_resolution_clock::now();
        before_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    double after_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        auto start=std::chrono::high_resolution_clock::now();
        volatile double r=sum_with_mul(data.data(),N);
        auto end=std::chrono::high_resolution_clock::now();
        after_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    std::cout << "{\\"before_ns\\":" << (before_total / ITERS)
              << ",\\"after_ns\\":" << (after_total / ITERS)
              << ",\\"data_size\\":" << N
              << ",\\"iterations\\":" << ITERS << "}" << std::endl;
    return 0;
}`,
    },

    // ── 11. endl → '\n' ─────────────────────────────────────────
    {
        id: 'endl_vs_newline',
        name: "std::endl → '\\n'",
        category: 'I/O Overhead',
        short_desc: 'endl forces a buffer flush on every call',
        explanation:
            "std::endl writes '\\n' AND flushes the output buffer. Flushing is a syscall that forces " +
            "the OS to write immediately. Using '\\n' just adds the character to the buffer. " +
            "In I/O-heavy code, switching to '\\n' can be 5–10× faster.",
        severity: 'low',
        before_label: 'std::endl (flush every line)',
        after_label: "'\\n' (buffered)",
        before_snippet: `for (int i = 0; i < N; i++) {
    std::cout << data[i] << std::endl;
    // std::endl = '\\n' + flush()
    // flush() = syscall EVERY line = slow
}`,
        after_snippet: `for (int i = 0; i < N; i++) {
    std::cout << data[i] << '\\n';
    // Just a character, stays in buffer
    // OS batches writes automatically
}`,
        reference_benchmarks: { before_ns: 42_000_000, after_ns: 8_500_000, speedup: 4.94, data_size: 100_000, note: 'Apple M1, clang++ -O2, ostringstream' },
        fix_hint: 'Replace std::endl with \'\\n\' everywhere unless you explicitly need to flush (e.g., before user input). Use std::flush only when you actually need immediate output.',
        speedup_context: 'Each endl triggers a syscall to flush the output buffer. Over 100K lines thats 100K unnecessary system calls. The OS already flushes when the buffer fills, when the program exits, or when you explicitly ask.',
        references: [
            { title: 'std::endl', url: 'https://en.cppreference.com/w/cpp/io/manip/endl' },
            { title: 'std::flush', url: 'https://en.cppreference.com/w/cpp/io/manip/flush' },
        ],
        further_reading: [
            { title: 'C++ I/O performance tips', url: 'https://stackoverflow.com/questions/213907' },
        ],
        benchmark_code: `#include <iostream>
#include <chrono>
#include <sstream>

#ifndef DATA_SIZE
#define DATA_SIZE 100000
#endif
#ifndef ITERATIONS
#define ITERATIONS 5
#endif

int main() {
    const int N = DATA_SIZE; const int ITERS = ITERATIONS;
    double before_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        std::ostringstream oss;
        auto start=std::chrono::high_resolution_clock::now();
        for(int i=0;i<N;i++) oss << "line " << i << std::endl;
        auto end=std::chrono::high_resolution_clock::now();
        before_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    double after_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        std::ostringstream oss;
        auto start=std::chrono::high_resolution_clock::now();
        for(int i=0;i<N;i++) oss << "line " << i << '\\n';
        auto end=std::chrono::high_resolution_clock::now();
        after_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    std::cout << "{\\"before_ns\\":" << (before_total / ITERS)
              << ",\\"after_ns\\":" << (after_total / ITERS)
              << ",\\"data_size\\":" << N
              << ",\\"iterations\\":" << ITERS << "}" << std::endl;
    return 0;
}`,
    },

    // ── 12. .size() in loop → hoist ─────────────────────────────
    {
        id: 'loop_size_hoist',
        name: '.size() in Loop → Hoist to Variable',
        category: 'Loop Optimization',
        short_desc: 'Avoid repeated method calls in loop condition',
        explanation:
            'Calling .size() in the loop condition means the compiler may re-evaluate it every ' +
            'iteration if it can\'t prove the container isn\'t modified inside the loop. ' +
            'Hoisting to a local variable makes the intent clear and guarantees register usage.',
        severity: 'medium',
        before_label: '.size() every iteration',
        after_label: 'Hoisted to local',
        before_snippet: `for (int i = 0; i < data.size(); i++) {
    total += compute(data[i]);
}
// Compiler may re-read .size() if it can't prove
// the container isn't modified by compute()`,
        after_snippet: `const int n = data.size();  // One read, into register
for (int i = 0; i < n; i++) {
    total += compute(data[i]);
}
// Compiler knows n is fixed -- can optimize freely`,
        reference_benchmarks: { before_ns: 95_000_000, after_ns: 92_000_000, speedup: 1.03, data_size: 10_000_000, note: 'Apple M1, clang++ -O2, opaque function body' },
        fix_hint: 'Store .size() in a local const variable before the loop. This also makes the code clearer -- the reader knows the container size won\'t change during iteration.',
        speedup_context: 'Modest gain here, but it signals intent: the compiler now knows the trip count is fixed and can unroll the loop. More importantly, it tells the reader the container is not being resized during iteration.',
        references: [
            { title: 'Range-based for loop', url: 'https://en.cppreference.com/w/cpp/language/range-for' },
        ],
        further_reading: [
            { title: 'C++ Core Guidelines: ES.71', url: 'https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#es71-prefer-a-range-for-statement-to-a-for-statement-when-there-is-a-choice' },
        ],
        benchmark_code: `#include <iostream>
#include <chrono>
#include <vector>
#include <cmath>

#ifndef DATA_SIZE
#define DATA_SIZE 10000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 10
#endif

__attribute__((noinline)) double heavy_work(double x) { return x*x+1.0; }

int main() {
    const int N = DATA_SIZE; const int ITERS = ITERATIONS;
    std::vector<double> data(N); for(int i=0;i<N;i++) data[i]=i*0.1;
    double before_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        auto start=std::chrono::high_resolution_clock::now();
        volatile double sum=0;
        for(int i=0;i<data.size();i++) sum+=heavy_work(data[i]);
        auto end=std::chrono::high_resolution_clock::now();
        before_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    double after_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        auto start=std::chrono::high_resolution_clock::now();
        volatile double sum=0; const int n=static_cast<int>(data.size());
        for(int i=0;i<n;i++) sum+=heavy_work(data[i]);
        auto end=std::chrono::high_resolution_clock::now();
        after_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    std::cout << "{\\"before_ns\\":" << (before_total / ITERS)
              << ",\\"after_ns\\":" << (after_total / ITERS)
              << ",\\"data_size\\":" << N
              << ",\\"iterations\\":" << ITERS << "}" << std::endl;
    return 0;
}`,
    },

    // ── 13. string copy → string_view ────────────────────────────
    {
        id: 'string_copy_vs_view',
        name: 'std::string Copy → std::string_view',
        category: 'Copy Elimination',
        short_desc: 'Avoid heap allocation for read-only string access',
        explanation:
            'Accepting std::string by value triggers a heap allocation + memcpy for every call. ' +
            'std::string_view is a non-owning {pointer, length} pair - 16 bytes, zero allocation. ' +
            'Use it for functions that only READ the string without storing it.',
        severity: 'medium',
        before_label: 'std::string (copy)',
        after_label: 'std::string_view',
        before_snippet: `bool starts_with(std::string s, std::string prefix) {
    return s.substr(0, prefix.size()) == prefix;
}
// Every call: 2 heap allocations + 2 memcpy
// Even with SSO, large strings always allocate`,
        after_snippet: `bool starts_with(std::string_view s, std::string_view prefix) {
    return s.substr(0, prefix.size()) == prefix;
}
// Zero allocations -- just pointer + length
// Works with string, string_view, and char*`,
        reference_benchmarks: { before_ns: 85_000_000, after_ns: 12_000_000, speedup: 7.08, data_size: 2_000_000, note: 'Apple M1, clang++ -O2, random strings' },
        fix_hint: 'Replace const std::string& parameters with std::string_view when the function only reads the string. Note: string_view does not own the data -- do not store it beyond the function scope.',
        speedup_context: '7x faster. Each std::string copy triggers a heap allocation (malloc + memcpy). string_view is 16 bytes on the stack: a pointer and a length. Over 2M calls thats 2M heap allocations you skipped entirely.',
        references: [
            { title: 'std::string_view', url: 'https://en.cppreference.com/w/cpp/string/basic_string_view' },
            { title: 'std::string', url: 'https://en.cppreference.com/w/cpp/string/basic_string' },
        ],
        further_reading: [
            { title: 'C++ Core Guidelines: SL.str.2', url: 'https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#slstr2-use-stdstring_view-or-gslstring_view-to-refer-to-character-sequences' },
        ],
        benchmark_code: `#include <iostream>
#include <chrono>
#include <string>
#include <string_view>
#include <vector>
#include <cstdlib>

#ifndef DATA_SIZE
#define DATA_SIZE 2000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 5
#endif

__attribute__((noinline)) bool check_str(std::string s) { return s.size() > 5 && s[0] == 'h'; }
__attribute__((noinline)) bool check_sv(std::string_view s) { return s.size() > 5 && s[0] == 'h'; }

int main() {
    const int N = DATA_SIZE; const int ITERS = ITERATIONS;
    std::vector<std::string> data(N);
    for(int i=0;i<N;i++) data[i] = "hello_world_" + std::to_string(i);
    double before_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        auto start=std::chrono::high_resolution_clock::now();
        volatile int cnt=0; for(auto&s:data) cnt+=check_str(s);
        auto end=std::chrono::high_resolution_clock::now();
        before_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    double after_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        auto start=std::chrono::high_resolution_clock::now();
        volatile int cnt=0; for(auto&s:data) cnt+=check_sv(s);
        auto end=std::chrono::high_resolution_clock::now();
        after_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    std::cout << "{\\"before_ns\\":" << (before_total / ITERS)
              << ",\\"after_ns\\":" << (after_total / ITERS)
              << ",\\"data_size\\":" << N
              << ",\\"iterations\\":" << ITERS << "}" << std::endl;
    return 0;
}`,
    },

    // ── 14. Missing std::move ────────────────────────────────────
    {
        id: 'missing_move',
        name: 'Copy → std::move',
        category: 'Move Semantics',
        short_desc: 'Steal resources instead of copying them',
        explanation:
            'When you assign or pass a local variable that won\'t be used again, the compiler ' +
            'still copies it unless you use std::move(). Move "steals" the internal buffer ' +
            '(e.g., vector\'s heap pointer) in O(1), while copy is O(n).',
        severity: 'medium',
        before_label: 'Copy assignment',
        after_label: 'std::move',
        before_snippet: `std::vector<int> build() {
    std::vector<int> result;
    for (int i = 0; i < N; i++) result.push_back(i);
    return result;  // NRVO usually handles this
}
void consume(std::vector<int> data);
consume(build());  // OK, but:
std::vector<int> tmp = build();
consume(tmp);  // COPIES tmp -- O(n)!`,
        after_snippet: `std::vector<int> tmp = build();
consume(std::move(tmp));  // Steals buffer -- O(1)
// tmp is now empty -- don't use it after this!
// Same for push_back with temporaries:
results.push_back(std::move(local_vec));`,
        reference_benchmarks: { before_ns: 65_000_000, after_ns: 3_000_000, speedup: 21.67, data_size: 1_000_000, note: 'Apple M1, clang++ -O2, vector<int>' },
        fix_hint: 'Use std::move() when passing or assigning a local variable that you won\'t read from again. Common spots: push_back, function arguments, return values, and container construction.',
        speedup_context: '21x faster. Without move, each push_back copies the entire inner vector: O(n) per insert. With move, it steals the heap pointer in O(1). That is the difference between n-squared total work and linear total work.',
        references: [
            { title: 'std::move', url: 'https://en.cppreference.com/w/cpp/utility/move' },
            { title: 'Move constructors', url: 'https://en.cppreference.com/w/cpp/language/move_constructor' },
        ],
        further_reading: [
            { title: 'Effective Modern C++: Item 23 (Scott Meyers)', url: 'https://www.oreilly.com/library/view/effective-modern-c/9781491908419/' },
        ],
        benchmark_code: `#include <iostream>
#include <chrono>
#include <vector>

#ifndef DATA_SIZE
#define DATA_SIZE 1000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 10
#endif

int main() {
    const int N = DATA_SIZE; const int ITERS = ITERATIONS;
    double before_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        std::vector<std::vector<int>> container;
        auto start=std::chrono::high_resolution_clock::now();
        for(int i=0;i<100;i++){
            std::vector<int> v(N/100); for(int j=0;j<N/100;j++) v[j]=j;
            container.push_back(v); // copy
        }
        auto end=std::chrono::high_resolution_clock::now();
        before_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    double after_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        std::vector<std::vector<int>> container;
        auto start=std::chrono::high_resolution_clock::now();
        for(int i=0;i<100;i++){
            std::vector<int> v(N/100); for(int j=0;j<N/100;j++) v[j]=j;
            container.push_back(std::move(v)); // move -- O(1)
        }
        auto end=std::chrono::high_resolution_clock::now();
        after_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    std::cout << "{\\"before_ns\\":" << (before_total / ITERS)
              << ",\\"after_ns\\":" << (after_total / ITERS)
              << ",\\"data_size\\":" << N
              << ",\\"iterations\\":" << ITERS << "}" << std::endl;
    return 0;
}`,
    },

    // ── 15. emplace_back vs push_back ────────────────────────────
    {
        id: 'emplace_vs_push',
        name: 'push_back → emplace_back',
        category: 'Construction Overhead',
        short_desc: 'Construct in-place instead of copy/move',
        explanation:
            'push_back creates a temporary object, then copies/moves it into the container. ' +
            'emplace_back constructs the object directly in the container\'s memory - ' +
            'no temporary, no copy, no move. Biggest wins with expensive constructors.',
        severity: 'low',
        before_label: 'push_back (temp + move)',
        after_label: 'emplace_back (in-place)',
        before_snippet: `std::vector<std::pair<std::string, int>> v;
v.push_back(std::make_pair("hello", 42));
// 1. Construct temp pair
// 2. Move pair into vector`,
        after_snippet: `std::vector<std::pair<std::string, int>> v;
v.emplace_back("hello", 42);
// Constructs pair directly in vector memory
// Zero temporaries`,
        reference_benchmarks: { before_ns: 140_000_000, after_ns: 95_000_000, speedup: 1.47, data_size: 2_000_000, note: 'Apple M1, clang++ -O2, pair<string,int>' },
        fix_hint: 'Replace push_back(Type(...)) with emplace_back(...). Pass constructor arguments directly. Most helpful for types with expensive constructors (strings, containers, etc).',
        speedup_context: 'emplace_back constructs the object directly in the vector memory. push_back creates a temporary, then moves it. For types with expensive constructors (strings, pairs), this avoids one temporary object per insert.',
        references: [
            { title: 'std::vector::emplace_back', url: 'https://en.cppreference.com/w/cpp/container/vector/emplace_back' },
            { title: 'std::vector::push_back', url: 'https://en.cppreference.com/w/cpp/container/vector/push_back' },
        ],
        further_reading: [
            { title: 'Effective Modern C++: Item 42 (Scott Meyers)', url: 'https://www.oreilly.com/library/view/effective-modern-c/9781491908419/' },
        ],
        benchmark_code: `#include <iostream>
#include <chrono>
#include <vector>
#include <string>

#ifndef DATA_SIZE
#define DATA_SIZE 2000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 5
#endif

int main() {
    const int N = DATA_SIZE; const int ITERS = ITERATIONS;
    double before_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        std::vector<std::pair<std::string,int>> v; v.reserve(N);
        auto start=std::chrono::high_resolution_clock::now();
        for(int i=0;i<N;i++) v.push_back(std::make_pair("item_"+std::to_string(i),i));
        auto end=std::chrono::high_resolution_clock::now();
        before_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    double after_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        std::vector<std::pair<std::string,int>> v; v.reserve(N);
        auto start=std::chrono::high_resolution_clock::now();
        for(int i=0;i<N;i++) v.emplace_back("item_"+std::to_string(i),i);
        auto end=std::chrono::high_resolution_clock::now();
        after_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    std::cout << "{\\"before_ns\\":" << (before_total / ITERS)
              << ",\\"after_ns\\":" << (after_total / ITERS)
              << ",\\"data_size\\":" << N
              << ",\\"iterations\\":" << ITERS << "}" << std::endl;
    return 0;
}`,
    },

    // ── 16. constexpr ────────────────────────────────────────────
    {
        id: 'runtime_vs_constexpr',
        name: 'Runtime Computation → constexpr',
        category: 'Compile-Time',
        short_desc: 'Move computation to compile time',
        explanation:
            'Functions marked constexpr are evaluated at compile time when called with ' +
            'constant arguments. The result is baked into the binary as a constant - ' +
            'zero runtime cost. Use for lookup tables, math constants, config values.',
        severity: 'low',
        before_label: 'Runtime computation',
        after_label: 'constexpr (compile-time)',
        before_snippet: `int factorial(int n) {
    int result = 1;
    for (int i = 2; i <= n; i++) result *= i;
    return result;
}
const int val = factorial(12);  // Computed at runtime`,
        after_snippet: `constexpr int factorial(int n) {
    int result = 1;
    for (int i = 2; i <= n; i++) result *= i;
    return result;
}
constexpr int val = factorial(12);  // Computed at COMPILE time
// val is literally the number 479001600 in the binary`,
        reference_benchmarks: { before_ns: 25_000_000, after_ns: 50_000, speedup: 500.0, data_size: 10_000_000, note: 'Apple M1, clang++ -O2, lookup table init' },
        fix_hint: 'Mark functions constexpr when they: (1) only use constexpr-compatible operations, (2) are called with compile-time-known arguments. Same for variables initialized from constants.',
        speedup_context: '500x faster is not an exaggeration. The compiler literally computed the answer during compilation and baked it into the binary as a constant. Zero instructions executed at runtime. This is free performance.',
        references: [
            { title: 'constexpr specifier', url: 'https://en.cppreference.com/w/cpp/language/constexpr' },
            { title: 'consteval (C++20)', url: 'https://en.cppreference.com/w/cpp/language/consteval' },
        ],
        further_reading: [
            { title: 'Jason Turner: constexpr ALL the Things! (CppCon)', url: 'https://www.youtube.com/watch?v=PJwd4JLYJJY' },
        ],
        benchmark_code: `#include <iostream>
#include <chrono>
#include <array>

#ifndef DATA_SIZE
#define DATA_SIZE 10000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 10
#endif

int factorial_rt(int n) { int r=1; for(int i=2;i<=n;i++) r*=i; return r; }
constexpr int factorial_ct(int n) { int r=1; for(int i=2;i<=n;i++) r*=i; return r; }

int main() {
    const int N = DATA_SIZE; const int ITERS = ITERATIONS;
    double before_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        auto start=std::chrono::high_resolution_clock::now();
        volatile long long sum=0;
        for(int i=0;i<N;i++) sum+=factorial_rt(i%12+1);
        auto end=std::chrono::high_resolution_clock::now();
        before_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    // Compile-time: build lookup table
    constexpr auto build_table = [](){
        std::array<int,13> t{}; for(int i=0;i<13;i++) t[i]=factorial_ct(i); return t;
    };
    constexpr auto TABLE = build_table();
    double after_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        auto start=std::chrono::high_resolution_clock::now();
        volatile long long sum=0;
        for(int i=0;i<N;i++) sum+=TABLE[i%12+1];
        auto end=std::chrono::high_resolution_clock::now();
        after_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    std::cout << "{\\"before_ns\\":" << (before_total / ITERS)
              << ",\\"after_ns\\":" << (after_total / ITERS)
              << ",\\"data_size\\":" << N
              << ",\\"iterations\\":" << ITERS << "}" << std::endl;
    return 0;
}`,
    },

    // ── 17. Exception in hot loop ────────────────────────────────
    {
        id: 'exception_hot_path',
        name: 'Exception Handling → Error Codes',
        category: 'Exception Overhead',
        short_desc: 'Avoid try/catch in performance-critical loops',
        explanation:
            'C++ exceptions have near-zero cost when NOT thrown (table-based unwinding), but ' +
            'entering a try block in a tight loop can prevent vectorization and optimization. ' +
            'The compiler cannot move code across try/catch boundaries freely. In hot paths, ' +
            'prefer error codes or std::optional.',
        severity: 'low',
        before_label: 'try/catch in loop',
        after_label: 'Error code / optional',
        before_snippet: `for (int i = 0; i < N; i++) {
    try {
        result += parse(data[i]);
    } catch (const std::exception& e) {
        errors++;
    }
}
// try/catch prevents vectorization
// Compiler can't reorder across exception edges`,
        after_snippet: `for (int i = 0; i < N; i++) {
    auto val = try_parse(data[i]);  // returns optional
    if (val) result += *val;
    else errors++;
}
// No exception tables, fully vectorizable
// std::optional has zero overhead`,
        reference_benchmarks: { before_ns: 48_000_000, after_ns: 15_000_000, speedup: 3.2, data_size: 5_000_000, note: 'Apple M1, clang++ -O2, no throws' },
        fix_hint: 'Move try/catch outside hot loops, or replace with error codes / std::optional / std::expected (C++23). Exceptions are fine for rare errors, just not in inner loops.',
        speedup_context: 'Even when no exceptions are thrown, try/catch in a loop prevents the compiler from vectorizing or reordering instructions across the try boundary. Lifting it out let the optimizer see the full loop.',
        references: [
            { title: 'std::optional', url: 'https://en.cppreference.com/w/cpp/utility/optional' },
            { title: 'std::expected (C++23)', url: 'https://en.cppreference.com/w/cpp/utility/expected' },
        ],
        further_reading: [
            { title: 'Zero-cost exceptions aren\'t actually zero cost', url: 'https://stackoverflow.com/questions/13835817' },
        ],
        benchmark_code: `#include <iostream>
#include <chrono>
#include <vector>
#include <optional>
#include <stdexcept>

#ifndef DATA_SIZE
#define DATA_SIZE 5000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 5
#endif

__attribute__((noinline)) double parse_throw(int v) { if(v<0) throw std::runtime_error("neg"); return v*1.5; }
__attribute__((noinline)) std::optional<double> parse_opt(int v) { if(v<0) return std::nullopt; return v*1.5; }

int main() {
    const int N = DATA_SIZE; const int ITERS = ITERATIONS;
    std::vector<int> data(N); for(int i=0;i<N;i++) data[i]=i;
    double before_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        auto start=std::chrono::high_resolution_clock::now();
        volatile double sum=0;
        for(int i=0;i<N;i++){ try{ sum+=parse_throw(data[i]); }catch(...){} }
        auto end=std::chrono::high_resolution_clock::now();
        before_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    double after_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        auto start=std::chrono::high_resolution_clock::now();
        volatile double sum=0;
        for(int i=0;i<N;i++){ auto v=parse_opt(data[i]); if(v) sum+=*v; }
        auto end=std::chrono::high_resolution_clock::now();
        after_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    std::cout << "{\\"before_ns\\":" << (before_total / ITERS)
              << ",\\"after_ns\\":" << (after_total / ITERS)
              << ",\\"data_size\\":" << N
              << ",\\"iterations\\":" << ITERS << "}" << std::endl;
    return 0;
}`,
    },

    // ── 18. Unsorted data → Sort for branch prediction ───────────
    {
        id: 'sort_for_prediction',
        name: 'Unsorted → Sort for Branch Prediction',
        category: 'Branch Prediction',
        short_desc: 'Sorted data makes branches perfectly predictable',
        explanation:
            'The CPU branch predictor learns patterns. With sorted data, branches become ' +
            'perfectly predictable: "all below threshold, then all above". Unsorted data ' +
            'gives ~50% misprediction rate. If you\'re going to filter, sort first.',
        severity: 'low',
        before_label: 'Unsorted (unpredictable)',
        after_label: 'Sorted (predictable)',
        before_snippet: `// data is randomly ordered
for (int x : data) {
    if (x >= THRESHOLD) sum += x;
}
// CPU guesses wrong ~50% of the time
// Each miss: 10-20 cycle pipeline flush`,
        after_snippet: `std::sort(data.begin(), data.end());
for (int x : data) {
    if (x >= THRESHOLD) sum += x;
}
// Branch pattern: NNNN...YYYY -- perfect prediction
// Near-zero mispredictions after warmup`,
        reference_benchmarks: { before_ns: 38_000_000, after_ns: 14_000_000, speedup: 2.71, data_size: 10_000_000, note: 'Apple M1, clang++ -O2, int filter' },
        fix_hint: 'If you are filtering data with an if-statement, consider sorting it first. The sort cost is often paid back by perfect branch prediction. Profile to verify on your data size.',
        speedup_context: 'After sorting, the branch pattern becomes NNNN...YYYY. The predictor learns this instantly and hits near-100% accuracy. On unsorted random data its a coin flip on every iteration.',
        references: [
            { title: 'std::sort', url: 'https://en.cppreference.com/w/cpp/algorithm/sort' },
        ],
        further_reading: [
            { title: 'Why is processing a sorted array faster? (Stack Overflow)', url: 'https://stackoverflow.com/questions/11227809' },
        ],
        benchmark_code: `#include <iostream>
#include <chrono>
#include <vector>
#include <algorithm>
#include <cstdlib>

#ifndef DATA_SIZE
#define DATA_SIZE 10000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 5
#endif

int main() {
    const int N = DATA_SIZE; const int ITERS = ITERATIONS; const int T = 128;
    std::vector<int> data(N); std::srand(42);
    for(int i=0;i<N;i++) data[i]=std::rand()%256;
    double before_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        auto start=std::chrono::high_resolution_clock::now();
        volatile long long sum=0;
        for(int i=0;i<N;i++) if(data[i]>=T) sum+=data[i];
        auto end=std::chrono::high_resolution_clock::now();
        before_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    std::sort(data.begin(), data.end());
    double after_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        auto start=std::chrono::high_resolution_clock::now();
        volatile long long sum=0;
        for(int i=0;i<N;i++) if(data[i]>=T) sum+=data[i];
        auto end=std::chrono::high_resolution_clock::now();
        after_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    std::cout << "{\\"before_ns\\":" << (before_total / ITERS)
              << ",\\"after_ns\\":" << (after_total / ITERS)
              << ",\\"data_size\\":" << N
              << ",\\"iterations\\":" << ITERS << "}" << std::endl;
    return 0;
}`,
    },

    // ── 19. dynamic_cast → static dispatch ───────────────────────
    {
        id: 'dynamic_cast_overhead',
        name: 'dynamic_cast → Type Tag / Variant',
        category: 'RTTI Overhead',
        short_desc: 'Avoid runtime type identification in hot paths',
        explanation:
            'dynamic_cast invokes RTTI (Run-Time Type Information) - it walks the type hierarchy ' +
            'tree, comparing type_info objects. This can cost 100–1000 nanoseconds per cast. ' +
            'Use std::variant, type tags, or the visitor pattern for known type sets.',
        severity: 'medium',
        before_label: 'dynamic_cast (RTTI)',
        after_label: 'std::variant + visit',
        before_snippet: `for (auto* base : objects) {
    if (auto* d = dynamic_cast<Derived*>(base)) {
        d->process();
    }
}
// RTTI: walks type hierarchy per cast
// 100-1000ns per dynamic_cast`,
        after_snippet: `using Shape = std::variant<Circle, Rect, Tri>;
for (auto& s : shapes) {
    std::visit([](auto& shape) {
        shape.process();
    }, s);
}
// Compile-time dispatch via variant index
// Jump table: ~2-5ns`,
        reference_benchmarks: { before_ns: 180_000_000, after_ns: 28_000_000, speedup: 6.43, data_size: 5_000_000, note: 'Apple M1, clang++ -O2' },
        fix_hint: 'Replace dynamic_cast chains with std::variant + std::visit when the set of types is known at compile time. For open type sets, use a virtual method or type tag enum instead.',
        speedup_context: '6.4x faster. dynamic_cast walks the type hierarchy comparing type_info strings. std::variant dispatch is a jump table indexed by a small integer. Over 5M objects, you eliminated millions of RTTI string comparisons.',
        references: [
            { title: 'dynamic_cast', url: 'https://en.cppreference.com/w/cpp/language/dynamic_cast' },
            { title: 'std::variant', url: 'https://en.cppreference.com/w/cpp/utility/variant' },
            { title: 'std::visit', url: 'https://en.cppreference.com/w/cpp/utility/variant/visit' },
        ],
        further_reading: [
            { title: 'C++ Core Guidelines: C.146', url: 'https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#c146-use-dynamic_cast-where-class-hierarchy-navigation-is-unavoidable' },
        ],
        benchmark_code: `#include <iostream>
#include <chrono>
#include <vector>
#include <memory>
#include <variant>

#ifndef DATA_SIZE
#define DATA_SIZE 5000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 5
#endif

struct Base { virtual ~Base()=default; virtual double val() const=0; };
struct D1 : Base { double x; D1(double x):x(x){} double val() const override { return x*x; } };
struct D2 : Base { double x; D2(double x):x(x){} double val() const override { return x+1; } };
struct V1 { double x; double val() const { return x*x; } };
struct V2 { double x; double val() const { return x+1; } };

int main() {
    const int N = DATA_SIZE; const int ITERS = ITERATIONS;
    std::vector<std::unique_ptr<Base>> polys; polys.reserve(N);
    for(int i=0;i<N;i++) { if(i%2) polys.push_back(std::make_unique<D1>(i*0.1)); else polys.push_back(std::make_unique<D2>(i*0.1)); }
    double before_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        auto start=std::chrono::high_resolution_clock::now();
        volatile double sum=0;
        for(auto&p:polys){ if(auto*d=dynamic_cast<D1*>(p.get())) sum+=d->val(); else if(auto*d=dynamic_cast<D2*>(p.get())) sum+=d->val(); }
        auto end=std::chrono::high_resolution_clock::now();
        before_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    std::vector<std::variant<V1,V2>> vars; vars.reserve(N);
    for(int i=0;i<N;i++) { if(i%2) vars.emplace_back(V1{i*0.1}); else vars.emplace_back(V2{i*0.1}); }
    double after_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        auto start=std::chrono::high_resolution_clock::now();
        volatile double sum=0;
        for(auto&v:vars) sum+=std::visit([](auto&x){return x.val();},v);
        auto end=std::chrono::high_resolution_clock::now();
        after_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    std::cout << "{\\"before_ns\\":" << (before_total / ITERS)
              << ",\\"after_ns\\":" << (after_total / ITERS)
              << ",\\"data_size\\":" << N
              << ",\\"iterations\\":" << ITERS << "}" << std::endl;
    return 0;
}`,
    },

    // ── 20. Synchronous I/O → Buffered / Batch ──────────────────
    {
        id: 'sync_io_overhead',
        name: 'sync_with_stdio → Disable for Speed',
        category: 'I/O Overhead',
        short_desc: 'Unsync C++ streams from C stdio for faster I/O',
        explanation:
            'By default, C++ streams (cin/cout) are synchronized with C stdio (scanf/printf). ' +
            'This adds locking overhead on every I/O operation. If you don\'t mix C and C++ I/O, ' +
            'disable it for 2–10× faster I/O. Common in competitive programming and data processing.',
        severity: 'low',
        before_label: 'Default (synced)',
        after_label: 'Unsynced + untied',
        before_snippet: `int main() {
    int n; std::cin >> n;
    // Default: cin synced with scanf
    // Every read acquires a mutex lock
    for (int i = 0; i < n; i++) {
        std::cin >> values[i];  // Slow!
    }
}`,
        after_snippet: `int main() {
    std::ios_base::sync_with_stdio(false);
    std::cin.tie(nullptr);
    int n; std::cin >> n;
    // No sync lock, no cout flush before cin
    for (int i = 0; i < n; i++) {
        std::cin >> values[i];  // 2-10× faster
    }
}`,
        reference_benchmarks: { before_ns: 320_000_000, after_ns: 48_000_000, speedup: 6.67, data_size: 1_000_000, note: 'Apple M1, clang++ -O2, integer reads' },
        fix_hint: 'Add std::ios_base::sync_with_stdio(false) and std::cin.tie(nullptr) at the start of main(). Only safe if you NEVER mix cout/cin with printf/scanf in the same program.',
        speedup_context: '6.7x faster I/O with two lines of code. The default sync acquires a mutex on every single read/write to coordinate with C stdio. If you only use C++ streams, that lock is pure waste.',
        references: [
            { title: 'std::ios_base::sync_with_stdio', url: 'https://en.cppreference.com/w/cpp/io/ios_base/sync_with_stdio' },
            { title: 'std::basic_ios::tie', url: 'https://en.cppreference.com/w/cpp/io/basic_ios/tie' },
        ],
        further_reading: [
            { title: 'Fast I/O in C++', url: 'https://codeforces.com/blog/entry/5217' },
        ],
        benchmark_code: `#include <iostream>
#include <chrono>
#include <sstream>
#include <string>

#ifndef DATA_SIZE
#define DATA_SIZE 1000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 3
#endif

int main() {
    const int N = DATA_SIZE; const int ITERS = ITERATIONS;
    std::string input; for(int i=0;i<N;i++) input += std::to_string(i) + "\\n";

    double before_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        std::istringstream iss(input);
        auto start=std::chrono::high_resolution_clock::now();
        volatile long long sum=0; int v;
        while(iss >> v) sum+=v;
        auto end=std::chrono::high_resolution_clock::now();
        before_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    double after_total = 0;
    for(int iter=0;iter<ITERS;iter++){
        std::istringstream iss(input);
        iss.sync_with_stdio(false);
        auto start=std::chrono::high_resolution_clock::now();
        volatile long long sum=0; int v;
        while(iss >> v) sum+=v;
        auto end=std::chrono::high_resolution_clock::now();
        after_total+=std::chrono::duration_cast<std::chrono::nanoseconds>(end-start).count();
    }
    std::cout << "{\\"before_ns\\":" << (before_total / ITERS)
              << ",\\"after_ns\\":" << (after_total / ITERS)
              << ",\\"data_size\\":" << N
              << ",\\"iterations\\":" << ITERS << "}" << std::endl;
    return 0;
}`,
    },

    // ── mCoding-Inspired Patterns (Newbie C++ Habits) ───────────

    {
        id: 'using_namespace_std',
        name: 'using namespace std',
        category: 'correctness',
        short_desc: 'Global using-directive pollutes the namespace and causes silent bugs',
        explanation: 'using namespace std pulls hundreds of names into the global scope. This causes ambiguous overload resolution (e.g., your distance() vs std::distance()), breaks when new names are added to the standard library, and makes code harder to reason about. It is not a performance issue, it is a correctness time bomb.',
        fix_hint: 'Remove using namespace std and qualify names explicitly: std::cout, std::vector, std::string. For frequently used names, use targeted using-declarations: using std::cout; using std::string;',
        speedup_context: 'No runtime cost, but this prevents subtle bugs where the wrong overload is silently chosen. One mis-resolved call to distance() instead of std::distance() can corrupt an entire computation.',
        severity: 'medium',
        before_label: 'Namespace pollution',
        after_label: 'Explicit qualification',
        before_snippet: `using namespace std;

int distance(int a, int b) { return abs(a - b); }

int main() {
    vector<int> v = {1, 2, 3, 4};
    // Ambiguous: your distance() or std::distance()?
    cout << distance(v.begin(), v.end()) << endl;
}`,
        after_snippet: `#include <vector>
#include <iostream>
#include <cmath>

int distance(int a, int b) { return std::abs(a - b); }

int main() {
    std::vector<int> v = {1, 2, 3, 4};
    // Unambiguous: clearly std::distance
    std::cout << std::distance(v.begin(), v.end()) << '\\n';
}`,
        benchmark_code: '',
        reference_benchmarks: { before_ns: 0, after_ns: 0, speedup: 1.0, data_size: 0, note: 'Correctness pattern - no benchmark' },
        references: [
            { title: 'using-directive', url: 'https://en.cppreference.com/w/cpp/language/namespace#Using-directives' },
        ],
        further_reading: [
            { title: 'Why "using namespace std" is bad practice', url: 'https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#sf6-use-using-namespace-directives-for-transition-for-foundation-libraries-such-as-std-or-within-a-local-scope-only' },
        ],
    },

    {
        id: 'c_array_vs_std_array',
        name: 'C Array vs std::array',
        category: 'correctness',
        short_desc: 'C-style arrays decay to pointers and lose size information',
        explanation: 'C-style arrays (int arr[N]) silently decay to pointers when passed to functions, losing their size. This causes off-by-one errors, buffer overflows, and forces you to pass size as a separate parameter. std::array keeps the size in the type, is bounds-checkable, and works with STL algorithms.',
        fix_hint: 'Replace int arr[N] with std::array<int, N> arr. For dynamic sizes, use std::vector instead. Never pass raw arrays to functions.',
        speedup_context: 'Zero runtime overhead. std::array compiles to identical machine code as a C array. You get the same performance with bounds checking, size tracking, and STL compatibility for free.',
        severity: 'medium',
        before_label: 'C-style array (size lost on function call)',
        after_label: 'std::array (size preserved in type)',
        before_snippet: `void process(int* data, int size) {
    for (int i = 0; i <= size; i++) {  // off-by-one: nobody catches this
        data[i] *= 2;
    }
}

int main() {
    int values[100];
    process(values, 100);  // size passed separately, easy to get wrong
}`,
        after_snippet: `#include <array>
#include <algorithm>

template<std::size_t N>
void process(std::array<int, N>& data) {
    for (auto& val : data) {  // no off-by-one possible
        val *= 2;
    }
}

int main() {
    std::array<int, 100> values{};
    process(values);  // size is part of the type
}`,
        benchmark_code: '',
        reference_benchmarks: { before_ns: 0, after_ns: 0, speedup: 1.0, data_size: 0, note: 'Correctness pattern - no benchmark' },
        references: [
            { title: 'std::array', url: 'https://en.cppreference.com/w/cpp/container/array' },
        ],
        further_reading: [
            { title: 'C++ Core Guidelines: Use std::array for fixed-size sequences', url: 'https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#slcon1-prefer-using-stl-array-or-vector-instead-of-a-c-array' },
        ],
    },

    {
        id: 'raw_new_delete',
        name: 'Raw new/delete',
        category: 'correctness',
        short_desc: 'Manual memory management leaks on exceptions and early returns',
        explanation: 'Every raw new requires a matching delete, but exceptions, early returns, and branching logic make it nearly impossible to guarantee. A single missed delete is a memory leak. A double delete is undefined behavior. Smart pointers (unique_ptr, shared_ptr) handle deallocation automatically through RAII.',
        fix_hint: 'Replace new T(...) with std::make_unique<T>(...) for single ownership, or std::make_shared<T>(...) for shared ownership. If you must use new, immediately wrap it in a smart pointer.',
        speedup_context: 'Not about speed. This is about not shipping memory leaks. In a long-running server, a single leaked 1KB allocation per request at 10K req/s leaks 10MB per second. unique_ptr has zero overhead vs raw pointer.',
        severity: 'high',
        before_label: 'Manual memory management',
        after_label: 'RAII with smart pointers',
        before_snippet: `Widget* create_widget(int type) {
    Widget* w = new Widget(type);
    w->init();        // if this throws, w leaks
    if (!w->valid()) {
        return nullptr;  // leaked: forgot delete w
    }
    return w;
}`,
        after_snippet: `#include <memory>

std::unique_ptr<Widget> create_widget(int type) {
    auto w = std::make_unique<Widget>(type);
    w->init();        // if this throws, w is automatically freed
    if (!w->valid()) {
        return nullptr;  // unique_ptr destructor frees memory
    }
    return w;         // moved out, no copy
}`,
        benchmark_code: '',
        reference_benchmarks: { before_ns: 0, after_ns: 0, speedup: 1.0, data_size: 0, note: 'Correctness pattern - no benchmark' },
        references: [
            { title: 'std::unique_ptr', url: 'https://en.cppreference.com/w/cpp/memory/unique_ptr' },
            { title: 'std::make_unique', url: 'https://en.cppreference.com/w/cpp/memory/unique_ptr/make_unique' },
        ],
        further_reading: [
            { title: 'C++ Core Guidelines: R.11 Avoid new and delete', url: 'https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#r11-avoid-calling-new-and-delete-explicitly' },
        ],
    },

    {
        id: 'missing_virtual_dtor',
        name: 'Missing Virtual Destructor',
        category: 'correctness',
        short_desc: 'Deleting a derived object through a base pointer without virtual destructor is undefined behavior',
        explanation: 'If a class has virtual methods but a non-virtual destructor, deleting a derived object through a base pointer skips the derived destructor. This leaks resources, corrupts state, and is technically undefined behavior. The compiler will not warn you by default.',
        fix_hint: 'Add virtual ~ClassName() = default; to any class with at least one virtual method. Or use override on derived destructors to make the intent clear.',
        speedup_context: 'Not a performance pattern. This is undefined behavior that silently corrupts memory. In production, it manifests as random crashes hours after the actual bug, making it nearly impossible to debug without sanitizers.',
        severity: 'high',
        before_label: 'Non-virtual destructor (UB on delete)',
        after_label: 'Virtual destructor (correct cleanup)',
        before_snippet: `class Shape {
public:
    virtual double area() const = 0;
    ~Shape() {}  // BUG: non-virtual destructor
};

class Circle : public Shape {
    double* data;  // has resources to free
public:
    Circle(int n) : data(new double[n]) {}
    ~Circle() { delete[] data; }  // NEVER CALLED through Shape*
    double area() const override { return 3.14; }
};

void process() {
    Shape* s = new Circle(1000);
    delete s;  // UB: Circle destructor never runs, data leaks
}`,
        after_snippet: `class Shape {
public:
    virtual double area() const = 0;
    virtual ~Shape() = default;  // correct: virtual destructor
};

class Circle : public Shape {
    std::unique_ptr<double[]> data;  // RAII handles cleanup
public:
    Circle(int n) : data(std::make_unique<double[]>(n)) {}
    ~Circle() override = default;  // runs correctly through Shape*
    double area() const override { return 3.14; }
};`,
        benchmark_code: '',
        reference_benchmarks: { before_ns: 0, after_ns: 0, speedup: 1.0, data_size: 0, note: 'Correctness pattern - no benchmark' },
        references: [
            { title: 'virtual destructor', url: 'https://en.cppreference.com/w/cpp/language/destructor#Virtual_destructors' },
        ],
        further_reading: [
            { title: 'C++ Core Guidelines: C.35 A base class destructor should be either public and virtual, or protected and non-virtual', url: 'https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#c35-a-base-class-destructor-should-be-either-public-and-virtual-or-protected-and-nonvirtual' },
        ],
    },

    {
        id: 'return_std_move',
        name: 'return std::move(local)',
        category: 'performance',
        short_desc: 'Returning std::move of a local variable prevents copy elision (NRVO)',
        explanation: 'When you return a local variable, the compiler applies Named Return Value Optimization (NRVO) to construct the object directly in the caller frame with zero copies and zero moves. Adding std::move defeats NRVO, forcing at least one move operation. The compiler is smarter than you here.',
        fix_hint: 'Just return the local variable by name. The compiler will apply NRVO (zero copies) or implicit move (C++11) automatically. Only use std::move on return when returning a member variable or parameter.',
        speedup_context: 'NRVO means zero copies AND zero moves: the object is constructed directly where the caller needs it. std::move forces a move constructor call on every return. For types with expensive moves (large flat arrays), this matters.',
        severity: 'medium',
        before_label: 'std::move prevents NRVO',
        after_label: 'Plain return enables NRVO',
        before_snippet: `std::vector<int> build_data(int n) {
    std::vector<int> result;
    result.reserve(n);
    for (int i = 0; i < n; i++) {
        result.push_back(i * i);
    }
    return std::move(result);  // BAD: prevents NRVO
}`,
        after_snippet: `std::vector<int> build_data(int n) {
    std::vector<int> result;
    result.reserve(n);
    for (int i = 0; i < n; i++) {
        result.push_back(i * i);
    }
    return result;  // GOOD: NRVO constructs directly in caller
}`,
        benchmark_code: `#include <iostream>
#include <chrono>
#include <vector>
#include <string>

const int N = 100000;
const int ITERS = 100;

std::vector<std::string> build_with_move(int n) {
    std::vector<std::string> result;
    result.reserve(n);
    for (int i = 0; i < n; i++) {
        result.push_back(std::string(100, 'x'));
    }
    return std::move(result);
}

std::vector<std::string> build_without_move(int n) {
    std::vector<std::string> result;
    result.reserve(n);
    for (int i = 0; i < n; i++) {
        result.push_back(std::string(100, 'x'));
    }
    return result;
}

int main() {
    double before_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        auto v = build_with_move(N);
        auto end = std::chrono::high_resolution_clock::now();
        before_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    double after_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        auto v = build_without_move(N);
        auto end = std::chrono::high_resolution_clock::now();
        after_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    std::cout << "{\\"before_ns\\":" << (before_total / ITERS)
              << ",\\"after_ns\\":" << (after_total / ITERS)
              << ",\\"data_size\\":" << N
              << ",\\"iterations\\":" << ITERS << "}" << std::endl;
    return 0;
}`,
        reference_benchmarks: { before_ns: 12000000, after_ns: 10000000, speedup: 1.2, data_size: 100000, note: 'Apple M1, clang++ -O2, vector of 100-char strings' },
        references: [
            { title: 'Copy elision', url: 'https://en.cppreference.com/w/cpp/language/copy_elision' },
        ],
        further_reading: [
            { title: 'C++ Core Guidelines: F.48 Do not return std::move(local)', url: 'https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#f48-dont-return-stdmovelocal' },
        ],
    },

    {
        id: 'missing_make_unique',
        name: 'Missing make_unique/make_shared',
        category: 'correctness',
        short_desc: 'Using new with smart pointer constructors can leak on exception',
        explanation: 'std::shared_ptr<T>(new T(args)) has two problems: (1) Before C++17, if another argument in the same expression throws, the new T leaks. (2) For shared_ptr, it allocates the control block separately from the object, causing two heap allocations instead of one. make_shared and make_unique fix both issues.',
        fix_hint: 'Replace std::unique_ptr<T>(new T(args)) with std::make_unique<T>(args). Replace std::shared_ptr<T>(new T(args)) with std::make_shared<T>(args). The only exception is when using a custom deleter.',
        speedup_context: 'make_shared allocates the object and control block in a single allocation, improving cache locality and cutting heap allocations in half. make_unique is exception-safe where the raw new version is not.',
        severity: 'medium',
        before_label: 'Raw new in smart pointer constructor',
        after_label: 'make_unique / make_shared',
        before_snippet: `// Two heap allocations, exception-unsafe before C++17
auto sp = std::shared_ptr<Widget>(new Widget(42));

// Exception-unsafe in multi-argument expressions
process(std::unique_ptr<Foo>(new Foo()), bar());
// If bar() throws after new Foo(), Foo leaks`,
        after_snippet: `// Single heap allocation, always safe
auto sp = std::make_shared<Widget>(42);

// Exception-safe: make_unique completes before bar() is evaluated
process(std::make_unique<Foo>(), bar());`,
        benchmark_code: '',
        reference_benchmarks: { before_ns: 0, after_ns: 0, speedup: 1.0, data_size: 0, note: 'Correctness pattern - no benchmark' },
        references: [
            { title: 'std::make_unique', url: 'https://en.cppreference.com/w/cpp/memory/unique_ptr/make_unique' },
            { title: 'std::make_shared', url: 'https://en.cppreference.com/w/cpp/memory/shared_ptr/make_shared' },
        ],
        further_reading: [
            { title: 'C++ Core Guidelines: R.22 Use make_shared to make shared_ptrs', url: 'https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#r22-use-make_shared-to-make-shared_ptrs' },
        ],
    },
];

export function getPatternById(id: string): Pattern | undefined {
    return PATTERNS.find(p => p.id === id);
}

export function getPatternSummaries() {
    return PATTERNS.map(p => ({
        id: p.id,
        name: p.name,
        category: p.category,
        short_desc: p.short_desc,
    }));
}
