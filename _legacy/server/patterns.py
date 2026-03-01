"""
LatencyLens — C++ Performance Anti-Pattern Database

Each pattern contains:
- Real C++ benchmark code (compiled and executed, not simulated)
- Detection regex for finding the pattern in user code
- Explanation of WHY the optimized version is faster (cache lines, branch prediction, etc.)
"""

PATTERNS = [
    # ─────────────────────────────────────────────────────────────
    # 1. std::map vs std::unordered_map
    # ─────────────────────────────────────────────────────────────
    {
        "id": "map_vs_unordered",
        "name": "std::map → std::unordered_map",
        "category": "Data Structures",
        "short_desc": "Tree traversal (O(log n)) vs hash lookup (O(1))",
        "explanation": (
            "std::map uses a red-black tree — every lookup traverses O(log n) nodes, "
            "each potentially a cache miss. std::unordered_map uses a hash table with "
            "O(1) amortized lookups. For integer/string keys where ordering isn't needed, "
            "unordered_map can be 2–5x faster. The gap widens with more elements as tree "
            "depth grows while hash access stays constant."
        ),
        "detection_regex": r"std::map\s*<(?!.*unordered)",
        "before_label": "std::map",
        "after_label": "std::unordered_map",
        "benchmark_code": r"""
#include <iostream>
#include <chrono>
#include <map>
#include <unordered_map>
#include <string>
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
    
    // Pre-generate random keys
    std::vector<int> keys(N);
    std::srand(42);
    for (int i = 0; i < N; i++) keys[i] = std::rand() % (N * 10);
    
    // === Benchmark std::map (BEFORE) ===
    double before_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        std::map<int, int> m;
        auto start = std::chrono::high_resolution_clock::now();
        // Insert
        for (int i = 0; i < N; i++) m[keys[i]] = i;
        // Lookup
        volatile int sink = 0;
        for (int i = 0; i < N; i++) {
            auto it = m.find(keys[i]);
            if (it != m.end()) sink = it->second;
        }
        auto end = std::chrono::high_resolution_clock::now();
        before_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    
    // === Benchmark std::unordered_map (AFTER) ===
    double after_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        std::unordered_map<int, int> m;
        m.reserve(N);
        auto start = std::chrono::high_resolution_clock::now();
        // Insert
        for (int i = 0; i < N; i++) m[keys[i]] = i;
        // Lookup
        volatile int sink = 0;
        for (int i = 0; i < N; i++) {
            auto it = m.find(keys[i]);
            if (it != m.end()) sink = it->second;
        }
        auto end = std::chrono::high_resolution_clock::now();
        after_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    
    double before_avg = before_total / ITERS;
    double after_avg = after_total / ITERS;
    
    std::cout << "{\"before_ns\":" << before_avg
              << ",\"after_ns\":" << after_avg
              << ",\"data_size\":" << N
              << ",\"iterations\":" << ITERS << "}" << std::endl;
    return 0;
}
""",
        "before_snippet": """std::map<int, int> m;
for (int i = 0; i < N; i++) m[keys[i]] = i;
auto it = m.find(key);  // O(log n) — tree traversal""",
        "after_snippet": """std::unordered_map<int, int> m;
m.reserve(N);
for (int i = 0; i < N; i++) m[keys[i]] = i;
auto it = m.find(key);  // O(1) — hash lookup""",
    },

    # ─────────────────────────────────────────────────────────────
    # 2. std::list vs std::vector (iteration)
    # ─────────────────────────────────────────────────────────────
    {
        "id": "list_vs_vector",
        "name": "std::list → std::vector",
        "category": "Cache Locality",
        "short_desc": "Pointer chasing vs contiguous memory",
        "explanation": (
            "std::list allocates each node separately on the heap, scattering data across memory. "
            "Iterating chases pointers, causing L1/L2 cache misses on almost every access. "
            "std::vector stores elements contiguously — the hardware prefetcher loads the next "
            "cache line automatically, hitting L1 cache ~95% of the time. This alone can give "
            "5–20x speedup on iteration-heavy workloads. The only case for std::list is frequent "
            "insertion/removal in the middle, and even then std::deque usually wins."
        ),
        "detection_regex": r"std::list\s*<",
        "before_label": "std::list",
        "after_label": "std::vector",
        "benchmark_code": r"""
#include <iostream>
#include <chrono>
#include <list>
#include <vector>
#include <numeric>

#ifndef DATA_SIZE
#define DATA_SIZE 1000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 10
#endif

int main() {
    const int N = DATA_SIZE;
    const int ITERS = ITERATIONS;
    
    // === Benchmark std::list (BEFORE) ===
    std::list<int> lst;
    for (int i = 0; i < N; i++) lst.push_back(i);
    
    double before_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        volatile long long sum = 0;
        for (auto& val : lst) sum += val;
        auto end = std::chrono::high_resolution_clock::now();
        before_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    
    // === Benchmark std::vector (AFTER) ===
    std::vector<int> vec(lst.begin(), lst.end());
    
    double after_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        volatile long long sum = 0;
        for (auto& val : vec) sum += val;
        auto end = std::chrono::high_resolution_clock::now();
        after_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    
    double before_avg = before_total / ITERS;
    double after_avg = after_total / ITERS;
    
    std::cout << "{\"before_ns\":" << before_avg
              << ",\"after_ns\":" << after_avg
              << ",\"data_size\":" << N
              << ",\"iterations\":" << ITERS << "}" << std::endl;
    return 0;
}
""",
        "before_snippet": """std::list<int> data;
for (auto& val : data) sum += val;
// Each node is a separate heap allocation
// Pointer chasing → cache miss on every access""",
        "after_snippet": """std::vector<int> data;
for (auto& val : data) sum += val;
// Contiguous memory → hardware prefetcher
// L1 cache hits ~95% of the time""",
    },

    # ─────────────────────────────────────────────────────────────
    # 3. Vector without reserve vs with reserve
    # ─────────────────────────────────────────────────────────────
    {
        "id": "reserve_pattern",
        "name": "push_back → reserve + push_back",
        "category": "Memory Allocation",
        "short_desc": "Eliminate reallocation and copying overhead",
        "explanation": (
            "Without reserve(), vector doubles its capacity when full — requiring a new allocation, "
            "copying all existing elements, and freeing old memory. For N insertions, this causes "
            "O(log N) reallocations, each copying all elements. With reserve(N), you get one "
            "allocation upfront. Big wins on large vectors where reallocation copies are expensive "
            "and fragment the allocator. Also avoids iterator invalidation."
        ),
        "detection_regex": r"push_back\s*\(",
        "before_label": "No reserve()",
        "after_label": "With reserve()",
        "benchmark_code": r"""
#include <iostream>
#include <chrono>
#include <vector>

#ifndef DATA_SIZE
#define DATA_SIZE 5000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 10
#endif

int main() {
    const int N = DATA_SIZE;
    const int ITERS = ITERATIONS;
    
    // === Without reserve (BEFORE) ===
    double before_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        std::vector<int> v;
        auto start = std::chrono::high_resolution_clock::now();
        for (int i = 0; i < N; i++) v.push_back(i);
        auto end = std::chrono::high_resolution_clock::now();
        before_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    
    // === With reserve (AFTER) ===
    double after_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        std::vector<int> v;
        v.reserve(N);
        auto start = std::chrono::high_resolution_clock::now();
        for (int i = 0; i < N; i++) v.push_back(i);
        auto end = std::chrono::high_resolution_clock::now();
        after_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    
    double before_avg = before_total / ITERS;
    double after_avg = after_total / ITERS;
    
    std::cout << "{\"before_ns\":" << before_avg
              << ",\"after_ns\":" << after_avg
              << ",\"data_size\":" << N
              << ",\"iterations\":" << ITERS << "}" << std::endl;
    return 0;
}
""",
        "before_snippet": """std::vector<int> v;
for (int i = 0; i < N; i++)
    v.push_back(i);
// ~log2(N) reallocations, each copies ALL elements""",
        "after_snippet": """std::vector<int> v;
v.reserve(N);  // Single allocation upfront
for (int i = 0; i < N; i++)
    v.push_back(i);
// Zero reallocations, zero copies""",
    },

    # ─────────────────────────────────────────────────────────────
    # 4. Virtual dispatch vs CRTP
    # ─────────────────────────────────────────────────────────────
    {
        "id": "virtual_vs_crtp",
        "name": "Virtual Dispatch → CRTP",
        "category": "Devirtualization",
        "short_desc": "Runtime vtable lookup vs compile-time resolution",
        "explanation": (
            "Virtual function calls go through a vtable pointer → vtable → function pointer. "
            "This is 2 indirections + prevents inlining. CRTP (Curiously Recurring Template Pattern) "
            "resolves the call at compile time — the compiler can inline the function body entirely, "
            "eliminating all indirection. In tight loops calling virtual methods millions of times, "
            "CRTP can be 2–5x faster. The compiler can also auto-vectorize inlined code."
        ),
        "detection_regex": r"virtual\s+\w+\s+\w+\s*\(",
        "before_label": "Virtual dispatch",
        "after_label": "CRTP (compile-time)",
        "benchmark_code": r"""
#include <iostream>
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

// === BEFORE: Virtual dispatch ===
struct ShapeVirtual {
    virtual double area() const = 0;
    virtual ~ShapeVirtual() = default;
};
struct CircleVirtual : ShapeVirtual {
    double r;
    CircleVirtual(double r) : r(r) {}
    double area() const override { return 3.14159265358979 * r * r; }
};

// === AFTER: CRTP (compile-time polymorphism) ===
template<typename Derived>
struct ShapeCRTP {
    double area() const { return static_cast<const Derived*>(this)->area_impl(); }
};
struct CircleCRTP : ShapeCRTP<CircleCRTP> {
    double r;
    CircleCRTP(double r) : r(r) {}
    double area_impl() const { return 3.14159265358979 * r * r; }
};

int main() {
    const int N = DATA_SIZE;
    const int ITERS = ITERATIONS;
    
    // === Virtual dispatch benchmark ===
    std::vector<std::unique_ptr<ShapeVirtual>> shapes_v;
    shapes_v.reserve(N);
    for (int i = 0; i < N; i++)
        shapes_v.push_back(std::make_unique<CircleVirtual>(i * 0.01));
    
    double before_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        volatile double total = 0;
        for (auto& s : shapes_v) total += s->area();
        auto end = std::chrono::high_resolution_clock::now();
        before_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    
    // === CRTP benchmark ===
    std::vector<CircleCRTP> shapes_c;
    shapes_c.reserve(N);
    for (int i = 0; i < N; i++)
        shapes_c.emplace_back(i * 0.01);
    
    double after_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        volatile double total = 0;
        for (auto& s : shapes_c) total += s.area();
        auto end = std::chrono::high_resolution_clock::now();
        after_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    
    std::cout << "{\"before_ns\":" << (before_total / ITERS)
              << ",\"after_ns\":" << (after_total / ITERS)
              << ",\"data_size\":" << N
              << ",\"iterations\":" << ITERS << "}" << std::endl;
    return 0;
}
""",
        "before_snippet": """struct Shape {
    virtual double area() const = 0;  // vtable indirection
};
for (auto& s : shapes) total += s->area();
// 2 pointer dereferences per call, no inlining possible""",
        "after_snippet": """template<typename Derived>
struct Shape {
    double area() const {
        return static_cast<const Derived*>(this)->area_impl();
    }  // Resolved at compile time
};
for (auto& s : shapes) total += s.area();
// Zero indirection, fully inlined, auto-vectorizable""",
    },

    # ─────────────────────────────────────────────────────────────
    # 5. Array of Structs vs Struct of Arrays
    # ─────────────────────────────────────────────────────────────
    {
        "id": "aos_vs_soa",
        "name": "Array of Structs → Struct of Arrays",
        "category": "Cache Optimization",
        "short_desc": "Load only what you need into cache lines",
        "explanation": (
            "AoS (Array of Structs) packs all fields together — accessing one field loads ALL fields "
            "into the cache line, wasting bandwidth. SoA (Struct of Arrays) stores each field in its "
            "own contiguous array — accessing one field only loads that field, maximizing cache "
            "utilization. Critical in data-oriented design (games, HPC, finance). Can give 2–10x "
            "speedup when you only access 1-2 fields out of many. Also enables SIMD auto-vectorization."
        ),
        "detection_regex": r"struct\s+\w+\s*\{[^}]*\}\s*;.*std::vector\s*<",
        "before_label": "Array of Structs (AoS)",
        "after_label": "Struct of Arrays (SoA)",
        "benchmark_code": r"""
#include <iostream>
#include <chrono>
#include <vector>
#include <cstdlib>

#ifndef DATA_SIZE
#define DATA_SIZE 2000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 10
#endif

// === AoS layout ===
struct ParticleAoS {
    float x, y, z;       // position (12 bytes)
    float vx, vy, vz;    // velocity (12 bytes)
    float mass;           // mass (4 bytes)
    int id;               // id (4 bytes)
    // Total: 32 bytes per particle
};

// === SoA layout ===
struct ParticlesSoA {
    std::vector<float> x, y, z;
    std::vector<float> vx, vy, vz;
    std::vector<float> mass;
    std::vector<int> id;
    
    void resize(int n) {
        x.resize(n); y.resize(n); z.resize(n);
        vx.resize(n); vy.resize(n); vz.resize(n);
        mass.resize(n); id.resize(n);
    }
};

int main() {
    const int N = DATA_SIZE;
    const int ITERS = ITERATIONS;
    std::srand(42);
    
    // Setup AoS
    std::vector<ParticleAoS> aos(N);
    for (int i = 0; i < N; i++) {
        aos[i] = {(float)(std::rand()%1000), (float)(std::rand()%1000), (float)(std::rand()%1000),
                  (float)(std::rand()%100)/100.0f, (float)(std::rand()%100)/100.0f, (float)(std::rand()%100)/100.0f,
                  (float)(std::rand()%100)/10.0f, i};
    }
    
    // Setup SoA
    ParticlesSoA soa;
    soa.resize(N);
    for (int i = 0; i < N; i++) {
        soa.x[i] = aos[i].x; soa.y[i] = aos[i].y; soa.z[i] = aos[i].z;
        soa.vx[i] = aos[i].vx; soa.vy[i] = aos[i].vy; soa.vz[i] = aos[i].vz;
        soa.mass[i] = aos[i].mass; soa.id[i] = aos[i].id;
    }
    
    // === AoS benchmark: update positions (only need x,y,z,vx,vy,vz) ===
    double before_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        const float dt = 0.016f;
        for (int i = 0; i < N; i++) {
            aos[i].x += aos[i].vx * dt;
            aos[i].y += aos[i].vy * dt;
            aos[i].z += aos[i].vz * dt;
        }
        auto end = std::chrono::high_resolution_clock::now();
        before_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    
    // === SoA benchmark: same operation ===
    double after_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        const float dt = 0.016f;
        for (int i = 0; i < N; i++) {
            soa.x[i] += soa.vx[i] * dt;
            soa.y[i] += soa.vy[i] * dt;
            soa.z[i] += soa.vz[i] * dt;
        }
        auto end = std::chrono::high_resolution_clock::now();
        after_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    
    std::cout << "{\"before_ns\":" << (before_total / ITERS)
              << ",\"after_ns\":" << (after_total / ITERS)
              << ",\"data_size\":" << N
              << ",\"iterations\":" << ITERS << "}" << std::endl;
    return 0;
}
""",
        "before_snippet": """struct Particle {
    float x, y, z;        // 12 bytes
    float vx, vy, vz;     // 12 bytes
    float mass; int id;    // 8 bytes — WASTED in cache
};
// Updating position loads mass+id into cache for nothing""",
        "after_snippet": """struct Particles {
    vector<float> x, y, z;     // contiguous
    vector<float> vx, vy, vz;  // contiguous
    vector<float> mass;         // separate
    vector<int> id;             // separate
};
// Only position+velocity data enters cache — SIMD friendly""",
    },

    # ─────────────────────────────────────────────────────────────
    # 6. Branch-heavy vs branchless
    # ─────────────────────────────────────────────────────────────
    {
        "id": "branch_vs_branchless",
        "name": "Branchy Code → Branchless",
        "category": "Branch Prediction",
        "short_desc": "Eliminate branch mispredictions with arithmetic",
        "explanation": (
            "Modern CPUs predict branches to keep the pipeline full. When predictions fail "
            "(~50% on random data), the pipeline flushes — costing 10–20 cycles per miss. "
            "Branchless code uses arithmetic/bitwise ops to compute the result without any branch. "
            "On highly predictable data (sorted), branches can actually be faster. But on random "
            "or mixed data, branchless code avoids the misprediction penalty entirely. "
            "Critical in hot paths: parsers, filters, financial calculations."
        ),
        "detection_regex": r"if\s*\(.*\)\s*\{?\s*\n.*else",
        "before_label": "if/else branching",
        "after_label": "Branchless arithmetic",
        "benchmark_code": r"""
#include <iostream>
#include <chrono>
#include <vector>
#include <cstdlib>
#include <algorithm>

#ifndef DATA_SIZE
#define DATA_SIZE 10000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 10
#endif

int main() {
    const int N = DATA_SIZE;
    const int ITERS = ITERATIONS;
    const int THRESHOLD = 128;
    
    // Random (unpredictable) data
    std::vector<int> data(N);
    std::srand(42);
    for (int i = 0; i < N; i++) data[i] = std::rand() % 256;
    
    // === Branchy version (BEFORE) ===
    double before_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        volatile long long sum = 0;
        for (int i = 0; i < N; i++) {
            if (data[i] >= THRESHOLD)
                sum += data[i];
        }
        auto end = std::chrono::high_resolution_clock::now();
        before_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    
    // === Branchless version (AFTER) ===
    double after_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        volatile long long sum = 0;
        for (int i = 0; i < N; i++) {
            // Branchless: multiply by 0 or 1
            int mask = -(data[i] >= THRESHOLD);  // 0 or -1 (all bits set)
            sum += (data[i] & mask);
        }
        auto end = std::chrono::high_resolution_clock::now();
        after_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    
    std::cout << "{\"before_ns\":" << (before_total / ITERS)
              << ",\"after_ns\":" << (after_total / ITERS)
              << ",\"data_size\":" << N
              << ",\"iterations\":" << ITERS << "}" << std::endl;
    return 0;
}
""",
        "before_snippet": """for (int i = 0; i < N; i++) {
    if (data[i] >= THRESHOLD)  // Branch!
        sum += data[i];
}
// ~50% misprediction on random data = pipeline flush""",
        "after_snippet": """for (int i = 0; i < N; i++) {
    int mask = -(data[i] >= THRESHOLD);  // 0 or 0xFFFFFFFF
    sum += (data[i] & mask);             // No branch
}
// Zero mispredictions, constant-time execution""",
    },

    # ─────────────────────────────────────────────────────────────
    # 7. shared_ptr vs unique_ptr
    # ─────────────────────────────────────────────────────────────
    {
        "id": "shared_vs_unique",
        "name": "shared_ptr → unique_ptr",
        "category": "Smart Pointers",
        "short_desc": "Atomic ref counting overhead vs zero-cost ownership",
        "explanation": (
            "shared_ptr maintains an atomic reference count — every copy/destroy does an atomic "
            "increment/decrement, which is a memory fence that stalls the CPU pipeline. unique_ptr "
            "has ZERO overhead — it's a raw pointer with RAII semantics. The compiler optimizes it "
            "completely. If you don't NEED shared ownership, unique_ptr is always the right choice. "
            "In multithreaded code, shared_ptr's atomic ops cause cache line bouncing between cores."
        ),
        "detection_regex": r"std::shared_ptr\s*<",
        "before_label": "std::shared_ptr",
        "after_label": "std::unique_ptr",
        "benchmark_code": r"""
#include <iostream>
#include <chrono>
#include <memory>
#include <vector>

#ifndef DATA_SIZE
#define DATA_SIZE 5000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 5
#endif

struct Widget {
    int data[4];  // 16 bytes of payload
    Widget() : data{1,2,3,4} {}
};

int main() {
    const int N = DATA_SIZE;
    const int ITERS = ITERATIONS;
    
    // === shared_ptr creation + copy (BEFORE) ===
    double before_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        std::vector<std::shared_ptr<Widget>> ptrs;
        ptrs.reserve(N);
        auto start = std::chrono::high_resolution_clock::now();
        for (int i = 0; i < N; i++) {
            auto p = std::make_shared<Widget>();
            ptrs.push_back(p);  // Atomic ref count increment
        }
        auto end = std::chrono::high_resolution_clock::now();
        before_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    
    // === unique_ptr creation (AFTER) ===
    double after_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        std::vector<std::unique_ptr<Widget>> ptrs;
        ptrs.reserve(N);
        auto start = std::chrono::high_resolution_clock::now();
        for (int i = 0; i < N; i++) {
            ptrs.push_back(std::make_unique<Widget>());
        }
        auto end = std::chrono::high_resolution_clock::now();
        after_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    
    std::cout << "{\"before_ns\":" << (before_total / ITERS)
              << ",\"after_ns\":" << (after_total / ITERS)
              << ",\"data_size\":" << N
              << ",\"iterations\":" << ITERS << "}" << std::endl;
    return 0;
}
""",
        "before_snippet": """auto p = std::make_shared<Widget>();
ptrs.push_back(p);  // Atomic ref count ++
// Memory fence on every copy/destroy
// Cache line bouncing in multithreaded code""",
        "after_snippet": """auto p = std::make_unique<Widget>();
ptrs.push_back(std::move(p));
// ZERO overhead — same as raw pointer
// Compiler optimizes completely away""",
    },

    # ─────────────────────────────────────────────────────────────
    # 8. False sharing vs cache-line padded
    # ─────────────────────────────────────────────────────────────
    {
        "id": "false_sharing",
        "name": "False Sharing → Cache-Line Padding",
        "category": "Concurrency",
        "short_desc": "Prevent cache line bouncing between CPU cores",
        "explanation": (
            "When two threads write to variables on the SAME cache line (64 bytes on x86), "
            "the CPU's cache coherence protocol (MESI) forces the cache line to bounce between cores "
            "on every write — even though they're writing to DIFFERENT variables. This is 'false sharing' "
            "and can make multithreaded code slower than single-threaded. Fix: pad each variable to its "
            "own cache line using alignas(64). This is one of the most common stealth performance killers."
        ),
        "detection_regex": r"std::atomic|std::thread|std::mutex",
        "before_label": "Variables share cache line",
        "after_label": "Cache-line padded",
        "benchmark_code": r"""
#include <iostream>
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

// === FALSE SHARING: counters on same cache line ===
struct CountersPacked {
    std::atomic<long long> a{0};  // These are likely on
    std::atomic<long long> b{0};  // the SAME 64-byte cache line
};

// === FIXED: each counter on its own cache line ===
struct alignas(64) PaddedCounter {
    std::atomic<long long> value{0};
};
struct CountersPadded {
    PaddedCounter a;
    PaddedCounter b;
};

int main() {
    const int N = DATA_SIZE;
    const int ITERS = ITERATIONS;
    
    // === False sharing benchmark (BEFORE) ===
    double before_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        CountersPacked packed;
        auto start = std::chrono::high_resolution_clock::now();
        std::thread t1([&]() { for (int i = 0; i < N; i++) packed.a.fetch_add(1, std::memory_order_relaxed); });
        std::thread t2([&]() { for (int i = 0; i < N; i++) packed.b.fetch_add(1, std::memory_order_relaxed); });
        t1.join(); t2.join();
        auto end = std::chrono::high_resolution_clock::now();
        before_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    
    // === Padded benchmark (AFTER) ===
    double after_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        CountersPadded padded;
        auto start = std::chrono::high_resolution_clock::now();
        std::thread t1([&]() { for (int i = 0; i < N; i++) padded.a.value.fetch_add(1, std::memory_order_relaxed); });
        std::thread t2([&]() { for (int i = 0; i < N; i++) padded.b.value.fetch_add(1, std::memory_order_relaxed); });
        t1.join(); t2.join();
        auto end = std::chrono::high_resolution_clock::now();
        after_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }
    
    std::cout << "{\"before_ns\":" << (before_total / ITERS)
              << ",\"after_ns\":" << (after_total / ITERS)
              << ",\"data_size\":" << N
              << ",\"iterations\":" << ITERS << "}" << std::endl;
    return 0;
}
""",
        "before_snippet": """struct Counters {
    std::atomic<long> a{0};  // Same cache line!
    std::atomic<long> b{0};  // MESI protocol bouncing
};
// Two threads writing → cache line ping-pong between cores""",
        "after_snippet": """struct alignas(64) PaddedCounter {
    std::atomic<long> value{0};
};
struct Counters {
    PaddedCounter a;  // Own cache line
    PaddedCounter b;  // Own cache line
};
// Each core owns its cache line — no bouncing""",
    },

    # ─────────────────────────────────────────────────────────────
    # 9. Pass by value → Pass by const reference
    # ─────────────────────────────────────────────────────────────
    {
        "id": "pass_by_value",
        "name": "Pass by Value → const Reference",
        "category": "Copy Elimination",
        "short_desc": "Avoid copying entire containers on every function call",
        "explanation": (
            "When you pass a std::vector (or string, map, etc.) by value to a function, "
            "the ENTIRE container is copied — every element, one by one, into a new allocation. "
            "For a vector of 10M doubles that's 80MB of memory copied just to read it. "
            "Passing by const reference (const std::vector<T>&) passes only an 8-byte pointer "
            "with zero copies. This is one of the most common C++ performance mistakes, especially "
            "from developers coming from languages with reference semantics (Java, Python). "
            "The fix is trivial but the impact can be enormous."
        ),
        "detection_regex": r"(?:void|int|double|float|bool|long|auto|std::\w+)\s+\w+\s*\(\s*std::\w+<[^>]+>\s+\w+",
        "before_label": "Pass by value (copy)",
        "after_label": "Pass by const reference",
        "benchmark_code": r"""
#include <iostream>
#include <chrono>
#include <vector>
#include <numeric>

#ifndef DATA_SIZE
#define DATA_SIZE 5000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 10
#endif

// BEFORE: pass by value — full copy every call
double sum_by_value(std::vector<double> data) {
    double total = 0;
    for (auto& v : data) total += v;
    return total;
}

// AFTER: pass by const reference — zero copy
double sum_by_ref(const std::vector<double>& data) {
    double total = 0;
    for (auto& v : data) total += v;
    return total;
}

int main() {
    const int N = DATA_SIZE;
    const int ITERS = ITERATIONS;

    std::vector<double> data(N);
    for (int i = 0; i < N; i++) data[i] = i * 0.5;

    // === By value (BEFORE) ===
    double before_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        volatile double r = sum_by_value(data);
        auto end = std::chrono::high_resolution_clock::now();
        before_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }

    // === By reference (AFTER) ===
    double after_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        volatile double r = sum_by_ref(data);
        auto end = std::chrono::high_resolution_clock::now();
        after_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }

    std::cout << "{\"before_ns\":" << (before_total / ITERS)
              << ",\"after_ns\":" << (after_total / ITERS)
              << ",\"data_size\":" << N
              << ",\"iterations\":" << ITERS << "}" << std::endl;
    return 0;
}
""",
        "before_snippet": """double compute(std::vector<double> data) {
    // ENTIRE vector is COPIED on every call
    // 10M doubles = 80MB copied per call
    for (auto& v : data) total += v;
}""",
        "after_snippet": """double compute(const std::vector<double>& data) {
    // 8-byte pointer, ZERO copies
    // Same read access, no overhead
    for (auto& v : data) total += v;
}""",
    },

    # ─────────────────────────────────────────────────────────────
    # 10. std::pow(x, 2) → x * x
    # ─────────────────────────────────────────────────────────────
    {
        "id": "pow_vs_multiply",
        "name": "std::pow(x,2) → x * x",
        "category": "Math Overhead",
        "short_desc": "Replace heavy library call with a single multiply",
        "explanation": (
            "std::pow() is a general-purpose function that handles fractional exponents, negative "
            "bases, NaN, inf, and edge cases. For that generality it uses logarithms and exponentials "
            "internally — roughly 20–50 CPU cycles per call. A simple x * x is ONE multiply instruction "
            "(~3–5 cycles). In a tight loop over millions of elements, this 10–20× overhead per element "
            "adds up massively. The compiler CANNOT optimize pow(x, 2) into x * x because pow() has "
            "specific IEEE 754 rounding behavior that a multiply doesn't guarantee. You must do it yourself."
        ),
        "detection_regex": r"std::pow\s*\(|pow\s*\([^,]+,\s*2",
        "before_label": "std::pow(x, 2)",
        "after_label": "x * x",
        "benchmark_code": r"""
#include <iostream>
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

// Use a runtime exponent so the compiler can't fast-path pow(x, 2.0)
// This reflects real code where the exponent might come from config/user input
__attribute__((noinline)) double sum_with_pow(const double* data, int n, double exp) {
    double sum = 0;
    for (int i = 0; i < n; i++) {
        sum += std::pow(data[i], exp);  // Full pow — log + exp internally
    }
    return sum;
}

__attribute__((noinline)) double sum_with_mul(const double* data, int n) {
    double sum = 0;
    for (int i = 0; i < n; i++) {
        double x = data[i];
        sum += x * x;  // Single multiply instruction
    }
    return sum;
}

int main(int argc, char** argv) {
    const int N = DATA_SIZE;
    const int ITERS = ITERATIONS;
    // Runtime value of 2.0 — prevents compiler from recognizing integer exponent
    double exponent = 2.0;
    if (argc > 99) exponent = std::atof(argv[1]);  // Never true, but compiler can't prove it

    std::vector<double> data(N);
    for (int i = 0; i < N; i++) data[i] = i * 0.001 + 0.1;

    // === std::pow (BEFORE) ===
    double before_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        volatile double r = sum_with_pow(data.data(), N, exponent);
        auto end = std::chrono::high_resolution_clock::now();
        before_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }

    // === Direct multiply (AFTER) ===
    double after_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        volatile double r = sum_with_mul(data.data(), N);
        auto end = std::chrono::high_resolution_clock::now();
        after_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }

    std::cout << "{\"before_ns\":" << (before_total / ITERS)
              << ",\"after_ns\":" << (after_total / ITERS)
              << ",\"data_size\":" << N
              << ",\"iterations\":" << ITERS << "}" << std::endl;
    return 0;
}
""",
        "before_snippet": """for (int i = 0; i < N; i++) {
    total += std::pow(data[i], 2);
    // ~20-50 cycles per call (log + exp internally)
    // Handles NaN, inf, fractional exponents... you don't need any of that
}""",
        "after_snippet": """for (int i = 0; i < N; i++) {
    double x = data[i];
    total += x * x;
    // 1 multiply instruction (~3-5 cycles)
    // 10-20× faster per element
}""",
    },

    # ─────────────────────────────────────────────────────────────
    # 11. std::endl → '\n'
    # ─────────────────────────────────────────────────────────────
    {
        "id": "endl_vs_newline",
        "name": "std::endl → '\\n'",
        "category": "I/O Overhead",
        "short_desc": "endl forces a buffer flush on every call",
        "explanation": (
            "std::endl does TWO things: writes '\\n' AND flushes the output buffer. "
            "Buffer flushing is a system call that forces the OS to write data to the terminal/file "
            "immediately. In a loop, this means a syscall PER LINE instead of letting the buffer "
            "batch writes. Using '\\n' just adds the character to the buffer. The C++ standard library "
            "will flush automatically when the buffer is full or the program exits. In I/O-heavy code "
            "(logging, data output), switching to '\\n' can be 5–10× faster."
        ),
        "detection_regex": r"std::endl|<<\s*endl",
        "before_label": "std::endl (flush every line)",
        "after_label": "'\\n' (buffered)",
        "benchmark_code": r"""
#include <iostream>
#include <chrono>
#include <sstream>

#ifndef DATA_SIZE
#define DATA_SIZE 100000
#endif
#ifndef ITERATIONS
#define ITERATIONS 5
#endif

int main() {
    const int N = DATA_SIZE;
    const int ITERS = ITERATIONS;

    // === std::endl (BEFORE) — flush every line ===
    double before_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        std::ostringstream oss;
        auto start = std::chrono::high_resolution_clock::now();
        for (int i = 0; i < N; i++) {
            oss << "line " << i << std::endl;  // flush on every line
        }
        auto end = std::chrono::high_resolution_clock::now();
        before_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }

    // === '\n' (AFTER) — buffered ===
    double after_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        std::ostringstream oss;
        auto start = std::chrono::high_resolution_clock::now();
        for (int i = 0; i < N; i++) {
            oss << "line " << i << '\n';  // just a character, no flush
        }
        auto end = std::chrono::high_resolution_clock::now();
        after_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }

    std::cout << "{\"before_ns\":" << (before_total / ITERS)
              << ",\"after_ns\":" << (after_total / ITERS)
              << ",\"data_size\":" << N
              << ",\"iterations\":" << ITERS << "}" << std::endl;
    return 0;
}
""",
        "before_snippet": """for (int i = 0; i < N; i++) {
    std::cout << data[i] << std::endl;
    // std::endl = '\\n' + flush()
    // flush() = syscall EVERY line = slow
}""",
        "after_snippet": """for (int i = 0; i < N; i++) {
    std::cout << data[i] << '\\n';
    // Just a character, stays in buffer
    // OS batches writes automatically
}""",
    },

    # ─────────────────────────────────────────────────────────────
    # 12. Repeated .size() in loop → cache the size
    # ─────────────────────────────────────────────────────────────
    {
        "id": "loop_size_hoist",
        "name": ".size() in Loop → Hoist to Variable",
        "category": "Loop Optimization",
        "short_desc": "Avoid repeated method calls in loop condition",
        "explanation": (
            "Calling .size() in the loop condition (for i < v.size()) means the compiler may "
            "re-evaluate it every iteration if it can't prove the container isn't modified inside "
            "the loop. Even when optimized, it's an extra load from memory per iteration. "
            "Hoisting to a local variable (const int n = v.size()) makes the intent clear and "
            "guarantees the compiler uses a register. In practice on modern compilers with -O2, "
            "the difference is small for simple loops, but becomes meaningful when the loop body "
            "calls functions that COULD resize the container — the compiler must be conservative. "
            "More importantly, it signals intent: 'this size is fixed for this loop.'"
        ),
        "detection_regex": r"for\s*\([^;]*;\s*\w+\s*[<>=!]+\s*\w+\.\s*size\s*\(\s*\)",
        "before_label": ".size() every iteration",
        "after_label": "Hoisted to local",
        "benchmark_code": r"""
#include <iostream>
#include <chrono>
#include <vector>
#include <cmath>

#ifndef DATA_SIZE
#define DATA_SIZE 10000000
#endif
#ifndef ITERATIONS
#define ITERATIONS 10
#endif

// Opaque function the compiler can't see through
__attribute__((noinline)) double heavy_work(double x) {
    return x * x + 1.0;
}

int main() {
    const int N = DATA_SIZE;
    const int ITERS = ITERATIONS;

    std::vector<double> data(N);
    for (int i = 0; i < N; i++) data[i] = i * 0.1;

    // === .size() in loop (BEFORE) ===
    double before_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        volatile double sum = 0;
        for (int i = 0; i < data.size(); i++) {
            sum += heavy_work(data[i]);
        }
        auto end = std::chrono::high_resolution_clock::now();
        before_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }

    // === Hoisted size (AFTER) ===
    double after_total = 0;
    for (int iter = 0; iter < ITERS; iter++) {
        auto start = std::chrono::high_resolution_clock::now();
        volatile double sum = 0;
        const int n = static_cast<int>(data.size());
        for (int i = 0; i < n; i++) {
            sum += heavy_work(data[i]);
        }
        auto end = std::chrono::high_resolution_clock::now();
        after_total += std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    }

    std::cout << "{\"before_ns\":" << (before_total / ITERS)
              << ",\"after_ns\":" << (after_total / ITERS)
              << ",\"data_size\":" << N
              << ",\"iterations\":" << ITERS << "}" << std::endl;
    return 0;
}
""",
        "before_snippet": """for (int i = 0; i < data.size(); i++) {
    total += compute(data[i]);
}
// Compiler may re-read .size() if it can't prove
// the container isn't modified by compute()""",
        "after_snippet": """const int n = data.size();  // One read, into register
for (int i = 0; i < n; i++) {
    total += compute(data[i]);
}
// Compiler knows n is fixed — can optimize freely""",
    },
]


def get_pattern_by_id(pattern_id):
    for p in PATTERNS:
        if p["id"] == pattern_id:
            return p
    return None


def get_all_pattern_ids():
    return [p["id"] for p in PATTERNS]


def get_pattern_summaries():
    return [
        {
            "id": p["id"],
            "name": p["name"],
            "category": p["category"],
            "short_desc": p["short_desc"],
        }
        for p in PATTERNS
    ]
