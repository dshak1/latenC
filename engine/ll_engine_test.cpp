/**
 * LatencyLens — Engine Test Suite
 *
 * Verifies all C++ components: arena allocator, SPSC queue,
 * constexpr patterns, and benchmark harness.
 *
 * Build:
 *   clang++ -O2 -std=c++17 -march=native -pthread ll_engine_test.cpp -o ll_engine_test
 */

#include "arena_allocator.hpp"
#include "spsc_queue.hpp"
#include "constexpr_patterns.hpp"
#include "bench_harness.hpp"

#include <cassert>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

// ── Test Helpers ─────────────────────────────────────────────────────

static int tests_passed = 0;
static int tests_failed = 0;

#define TEST(name) \
    void test_##name(); \
    struct Register_##name { \
        Register_##name() { \
            std::cout << "  " << #name << "... "; \
            try { test_##name(); std::cout << "✓\n"; ++tests_passed; } \
            catch (const std::exception& e) { std::cout << "✗ " << e.what() << "\n"; ++tests_failed; } \
            catch (...) { std::cout << "✗ unknown error\n"; ++tests_failed; } \
        } \
    } register_##name; \
    void test_##name()

#define EXPECT(cond) \
    if (!(cond)) throw std::runtime_error("EXPECT failed: " #cond " at line " + std::to_string(__LINE__))

#define EXPECT_EQ(a, b) \
    if ((a) != (b)) throw std::runtime_error( \
        "EXPECT_EQ failed: " #a " != " #b " at line " + std::to_string(__LINE__))

// ── Arena Allocator Tests ────────────────────────────────────────────

TEST(arena_basic_alloc) {
    ll::Arena arena(4096);
    int* p = arena.create<int>(42);
    EXPECT(p != nullptr);
    EXPECT_EQ(*p, 42);
}

TEST(arena_alignment) {
    ll::Arena arena(4096);
    // Allocate a char to misalign
    (void)arena.create<char>('x');
    // Now allocate a double — must be aligned
    double* d = arena.create<double>(3.14);
    EXPECT(reinterpret_cast<uintptr_t>(d) % alignof(double) == 0);
}

TEST(arena_array_alloc) {
    ll::Arena arena(4096);
    int* arr = arena.create_array<int>(100);
    for (int i = 0; i < 100; ++i) arr[i] = i;
    int sum = 0;
    for (int i = 0; i < 100; ++i) sum += arr[i];
    EXPECT_EQ(sum, 4950);
}

TEST(arena_string_interning) {
    ll::Arena arena(4096);
    const char* s1 = arena.intern_string("hello");
    const char* s2 = arena.intern_string("world");
    EXPECT(std::string(s1) == "hello");
    EXPECT(std::string(s2) == "world");
    EXPECT(s1 != s2); // Different allocations
}

TEST(arena_cross_block) {
    // Force multiple blocks
    ll::Arena arena(64); // tiny blocks
    for (int i = 0; i < 100; ++i) {
        int* p = arena.create<int>(i);
        EXPECT_EQ(*p, i);
    }
    EXPECT(arena.block_count() > 1);
}

TEST(arena_stats) {
    ll::Arena arena(4096);
    for (int i = 0; i < 50; ++i) (void)arena.create<int>(i);
    EXPECT_EQ(arena.num_allocations(), 50u);
    EXPECT(arena.bytes_used() >= 50 * sizeof(int));
}

TEST(arena_stl_allocator) {
    ll::Arena arena(4096);
    ll::ArenaAllocator<int> alloc(arena);
    ll::ArenaVector<int> vec(alloc);
    for (int i = 0; i < 100; ++i) vec.push_back(i);
    EXPECT_EQ(vec.size(), 100u);
    int sum = 0;
    for (int v : vec) sum += v;
    EXPECT_EQ(sum, 4950);
}

TEST(arena_reset) {
    ll::Arena arena(4096);
    (void)arena.create<int>(1);
    (void)arena.create<int>(2);
    EXPECT_EQ(arena.num_allocations(), 2u);
    arena.reset();
    EXPECT_EQ(arena.num_allocations(), 0u);
    // Can still allocate after reset
    int* p = arena.create<int>(99);
    EXPECT_EQ(*p, 99);
}

// ── SPSC Queue Tests ─────────────────────────────────────────────────

TEST(spsc_basic) {
    ll::SPSCQueue<int, 8> q;
    EXPECT(q.empty());
    EXPECT(q.try_push(42));
    EXPECT(!q.empty());
    auto val = q.try_pop();
    EXPECT(val.has_value());
    EXPECT_EQ(*val, 42);
    EXPECT(q.empty());
}

TEST(spsc_fill_and_drain) {
    ll::SPSCQueue<int, 8> q;
    // Capacity is rounded up to 8
    for (int i = 0; i < 8; ++i) {
        EXPECT(q.try_push(i));
    }
    EXPECT(!q.try_push(99)); // Full
    for (int i = 0; i < 8; ++i) {
        auto val = q.try_pop();
        EXPECT(val.has_value());
        EXPECT_EQ(*val, i);
    }
    EXPECT(!q.try_pop().has_value()); // Empty
}

TEST(spsc_wraparound) {
    ll::SPSCQueue<int, 4> q;
    // Push 3, pop 3, push 3, pop 3 — tests wraparound
    for (int round = 0; round < 10; ++round) {
        for (int i = 0; i < 3; ++i) EXPECT(q.try_push(round * 10 + i));
        for (int i = 0; i < 3; ++i) {
            auto v = q.try_pop();
            EXPECT_EQ(*v, round * 10 + i);
        }
    }
}

TEST(spsc_string_type) {
    ll::SPSCQueue<std::string, 16> q;
    q.try_push("hello");
    q.try_push("world");
    auto s1 = q.try_pop();
    auto s2 = q.try_pop();
    EXPECT_EQ(*s1, "hello");
    EXPECT_EQ(*s2, "world");
}

TEST(spsc_concurrent) {
    // The real test — producer and consumer on separate threads
    constexpr size_t N = 1000000;
    ll::SPSCQueue<uint64_t, 1024> q;

    std::thread producer([&] {
        for (uint64_t i = 0; i < N; ++i) {
            while (!q.try_push(i)) { /* spin */ }
        }
    });

    uint64_t sum = 0;
    uint64_t expected_next = 0;
    size_t received = 0;

    while (received < N) {
        auto val = q.try_pop();
        if (val) {
            EXPECT_EQ(*val, expected_next); // Verify ordering
            sum += *val;
            ++expected_next;
            ++received;
        }
    }

    producer.join();

    // Sum of 0..N-1
    uint64_t expected_sum = N * (N - 1) / 2;
    EXPECT_EQ(sum, expected_sum);
}

// ── Constexpr Pattern Tests ──────────────────────────────────────────

TEST(constexpr_find) {
    EXPECT_EQ(ll::ct::find_substring("hello world", "world"), 6);
    EXPECT_EQ(ll::ct::find_substring("hello world", "xyz"), -1);
    EXPECT_EQ(ll::ct::find_substring("", "abc"), -1);
    EXPECT_EQ(ll::ct::find_substring("abc", ""), 0);
}

TEST(constexpr_contains) {
    EXPECT(ll::ct::contains("std::map<int>", "std::map<"));
    EXPECT(!ll::ct::contains("std::unordered_map<int>", "std::map<"));
    EXPECT(ll::ct::contains("v.push_back(x)", "push_back("));
}

TEST(constexpr_pattern_matching) {
    // These are verified at compile time via static_assert too
    constexpr auto count = ll::ct::count_quick_matches("std::map<int, std::shared_ptr<T>>");
    EXPECT_EQ(count, 2u); // map + shared_ptr
}

TEST(constexpr_fnv1a) {
    // Different strings → different hashes
    EXPECT(ll::ct::fnv1a("std::map") != ll::ct::fnv1a("std::unordered_map"));
    // Same string → same hash
    EXPECT_EQ(ll::ct::fnv1a("hello"), ll::ct::fnv1a("hello"));
    // User-defined literal
    using namespace ll::ct;
    EXPECT_EQ("test"_hash, fnv1a("test"));
}

TEST(constexpr_fixed_string) {
    constexpr ll::ct::FixedString fs("hello");
    EXPECT_EQ(fs.size(), 5u);
    EXPECT_EQ(fs[0], 'h');
    EXPECT(fs.view() == "hello");
}

TEST(constexpr_composer) {
    auto composer = ll::ct::compose_patterns(
        [](std::string_view s) { return ll::ct::contains(s, "map"); },
        [](std::string_view s) { return ll::ct::contains(s, "vector"); },
        [](std::string_view s) { return ll::ct::contains(s, "list"); }
    );

    uint64_t mask = composer.scan("std::map and std::list");
    EXPECT(mask & 1);  // map matched
    EXPECT(!(mask & 2)); // vector didn't match
    EXPECT(mask & 4);  // list matched
}

// ── Benchmark Harness Tests ──────────────────────────────────────────

TEST(bench_do_not_optimize) {
    int x = 42;
    ll::DoNotOptimize(x);
    EXPECT_EQ(x, 42); // Value unchanged
}

TEST(bench_stats_computation) {
    std::vector<int64_t> timings = {100, 200, 150, 180, 120, 160, 140, 170, 130, 190};
    auto stats = ll::Stats::compute(timings);
    EXPECT(stats.mean_ns > 0);
    EXPECT(stats.median_ns > 0);
    EXPECT(stats.stddev_ns >= 0);
    EXPECT(stats.min_ns <= stats.max_ns);
    EXPECT(stats.p95_ns <= stats.max_ns);
    EXPECT_EQ(stats.samples, 10u);
}

TEST(bench_suite_runs) {
    ll::BenchSuite suite("test_suite", 1, 5);
    suite.set_data_size(1000);

    suite.add("fast", [](ll::State& s) {
        int sum = 0;
        for (auto _ : s) sum += 1;
        ll::DoNotOptimize(sum);
    });

    suite.add("slow", [](ll::State& s) {
        volatile int sum = 0;
        for (size_t i = 0; i < 1000; ++i) sum += 1;
        ll::DoNotOptimize(sum);
    });

    suite.run();
    EXPECT_EQ(suite.results().size(), 2u);
    EXPECT(suite.results()[0].stats.mean_ns > 0);
    EXPECT(suite.results()[1].stats.mean_ns > 0);
}

TEST(bench_json_output) {
    ll::BenchSuite suite("json_test", 1, 3);
    suite.add("dummy", [](ll::State& s) {
        ll::DoNotOptimize(42);
    });
    suite.run();

    std::ostringstream oss;
    suite.report_json(oss);
    std::string json = oss.str();
    EXPECT(json.find("\"suite\":\"json_test\"") != std::string::npos);
    EXPECT(json.find("\"mean_ns\"") != std::string::npos);
}

// ── Main ─────────────────────────────────────────────────────────────

int main() {
    std::cout << "\n⚡ LatencyLens Engine Test Suite\n";
    std::cout << "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";

    // Tests run via constructors above

    std::cout << "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
    std::cout << "  " << tests_passed << " passed, " << tests_failed << " failed\n\n";

    return tests_failed > 0 ? 1 : 0;
}
