/**
 * LatencyLens — Benchmark Runner
 * 
 * Standalone C++ binary that runs all anti-pattern benchmarks using
 * the ll::BenchSuite harness. Outputs JSON for server integration.
 *
 * Build:
 *   clang++ -O2 -std=c++17 -march=native ll_bench_runner.cpp -o ll_bench_runner -lpthread
 *
 * Usage:
 *   ./ll_bench_runner --pattern map_vs_unordered --size 100000
 *   ./ll_bench_runner --pattern all --size 100000
 *   ./ll_bench_runner --pattern map_vs_unordered --scale 1000,10000,100000,1000000
 */

#include "bench_harness.hpp"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstring>
#include <deque>
#include <fstream>
#include <iostream>
#include <list>
#include <map>
#include <memory>
#include <numeric>
#include <random>
#include <sstream>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

// ── Pattern Benchmarks ───────────────────────────────────────────────

void bench_map_vs_unordered(size_t data_size) {
    ll::BenchSuite suite("map_vs_unordered", 3, 20);
    suite.set_data_size(data_size);

    std::mt19937 rng(42);
    std::vector<int> keys(data_size);
    std::iota(keys.begin(), keys.end(), 0);
    std::shuffle(keys.begin(), keys.end(), rng);

    suite.add("std::map", [&](ll::State& s) {
        std::map<int, int> m;
        for (size_t i = 0; i < data_size; ++i) m[keys[i]] = static_cast<int>(i);
        int sum = 0;
        for (size_t i = 0; i < data_size; ++i) sum += m[keys[i]];
        ll::DoNotOptimize(sum);
    });

    suite.add("std::unordered_map", [&](ll::State& s) {
        std::unordered_map<int, int> m;
        m.reserve(data_size);
        for (size_t i = 0; i < data_size; ++i) m[keys[i]] = static_cast<int>(i);
        int sum = 0;
        for (size_t i = 0; i < data_size; ++i) sum += m[keys[i]];
        ll::DoNotOptimize(sum);
    });

    suite.run();
    suite.report_json(std::cout);
}

void bench_list_vs_vector(size_t data_size) {
    ll::BenchSuite suite("list_vs_vector", 3, 20);
    suite.set_data_size(data_size);

    suite.add("std::list", [&](ll::State& s) {
        std::list<int> l;
        for (size_t i = 0; i < data_size; ++i) l.push_back(static_cast<int>(i));
        long sum = 0;
        for (int v : l) sum += v;
        ll::DoNotOptimize(sum);
    });

    suite.add("std::vector", [&](ll::State& s) {
        std::vector<int> v;
        v.reserve(data_size);
        for (size_t i = 0; i < data_size; ++i) v.push_back(static_cast<int>(i));
        long sum = 0;
        for (int x : v) sum += x;
        ll::DoNotOptimize(sum);
    });

    suite.run();
    suite.report_json(std::cout);
}

void bench_reserve_pattern(size_t data_size) {
    ll::BenchSuite suite("reserve_pattern", 3, 20);
    suite.set_data_size(data_size);

    suite.add("no_reserve", [&](ll::State& s) {
        std::vector<int> v;
        for (size_t i = 0; i < data_size; ++i) v.push_back(static_cast<int>(i));
        ll::DoNotOptimize(v.data());
    });

    suite.add("with_reserve", [&](ll::State& s) {
        std::vector<int> v;
        v.reserve(data_size);
        for (size_t i = 0; i < data_size; ++i) v.push_back(static_cast<int>(i));
        ll::DoNotOptimize(v.data());
    });

    suite.run();
    suite.report_json(std::cout);
}

void bench_virtual_vs_crtp(size_t data_size) {
    // Virtual dispatch
    struct Base { virtual int compute(int x) const = 0; virtual ~Base() = default; };
    struct Derived : Base { int compute(int x) const override { return x * 2 + 1; } };

    ll::BenchSuite suite("virtual_vs_crtp", 3, 20);
    suite.set_data_size(data_size);

    auto obj = std::make_unique<Derived>();
    Base* base_ptr = obj.get();

    suite.add("virtual_dispatch", [&](ll::State& s) {
        long sum = 0;
        for (size_t i = 0; i < data_size; ++i) {
            sum += base_ptr->compute(static_cast<int>(i));
        }
        ll::DoNotOptimize(sum);
    });

    // Direct call (simulates devirtualization / CRTP)
    suite.add("direct_call", [&](ll::State& s) {
        Derived d;
        long sum = 0;
        for (size_t i = 0; i < data_size; ++i) {
            sum += d.compute(static_cast<int>(i));
        }
        ll::DoNotOptimize(sum);
    });

    suite.run();
    suite.report_json(std::cout);
}

void bench_aos_vs_soa(size_t data_size) {
    ll::BenchSuite suite("aos_vs_soa", 3, 20);
    suite.set_data_size(data_size);

    // AoS
    struct Particle { float x, y, z, vx, vy, vz; float padding[2]; };

    suite.add("array_of_structs", [&](ll::State& s) {
        std::vector<Particle> particles(data_size);
        for (size_t i = 0; i < data_size; ++i) {
            particles[i].x = static_cast<float>(i);
            particles[i].y = static_cast<float>(i) * 0.5f;
        }
        float sum = 0;
        for (size_t i = 0; i < data_size; ++i) sum += particles[i].x + particles[i].y;
        ll::DoNotOptimize(sum);
    });

    // SoA
    suite.add("struct_of_arrays", [&](ll::State& s) {
        std::vector<float> x(data_size), y(data_size);
        for (size_t i = 0; i < data_size; ++i) {
            x[i] = static_cast<float>(i);
            y[i] = static_cast<float>(i) * 0.5f;
        }
        float sum = 0;
        for (size_t i = 0; i < data_size; ++i) sum += x[i] + y[i];
        ll::DoNotOptimize(sum);
    });

    suite.run();
    suite.report_json(std::cout);
}

void bench_branch_vs_branchless(size_t data_size) {
    ll::BenchSuite suite("branch_vs_branchless", 3, 20);
    suite.set_data_size(data_size);

    std::mt19937 rng(42);
    std::vector<int> data(data_size);
    for (auto& v : data) v = static_cast<int>(rng() % 256);

    suite.add("branchy", [&](ll::State& s) {
        long sum = 0;
        for (size_t i = 0; i < data_size; ++i) {
            if (data[i] >= 128) sum += data[i];
        }
        ll::DoNotOptimize(sum);
    });

    suite.add("branchless", [&](ll::State& s) {
        long sum = 0;
        for (size_t i = 0; i < data_size; ++i) {
            sum += (~((data[i] - 128) >> 31)) & data[i];
        }
        ll::DoNotOptimize(sum);
    });

    suite.run();
    suite.report_json(std::cout);
}

void bench_shared_vs_unique(size_t data_size) {
    ll::BenchSuite suite("shared_vs_unique", 3, 20);
    suite.set_data_size(data_size);

    suite.add("shared_ptr", [&](ll::State& s) {
        std::vector<std::shared_ptr<int>> ptrs;
        ptrs.reserve(data_size);
        for (size_t i = 0; i < data_size; ++i) {
            ptrs.push_back(std::make_shared<int>(static_cast<int>(i)));
        }
        long sum = 0;
        for (auto& p : ptrs) sum += *p;
        ll::DoNotOptimize(sum);
    });

    suite.add("unique_ptr", [&](ll::State& s) {
        std::vector<std::unique_ptr<int>> ptrs;
        ptrs.reserve(data_size);
        for (size_t i = 0; i < data_size; ++i) {
            ptrs.push_back(std::make_unique<int>(static_cast<int>(i)));
        }
        long sum = 0;
        for (auto& p : ptrs) sum += *p;
        ll::DoNotOptimize(sum);
    });

    suite.run();
    suite.report_json(std::cout);
}

void bench_false_sharing(size_t data_size) {
    ll::BenchSuite suite("false_sharing", 3, 15);
    suite.set_data_size(data_size);

    suite.add("false_sharing", [&](ll::State& s) {
        struct Counters { std::atomic<long> a{0}; std::atomic<long> b{0}; };
        Counters c;
        auto work = [&](std::atomic<long>& counter) {
            for (size_t i = 0; i < data_size; ++i) counter.fetch_add(1, std::memory_order_relaxed);
        };
        std::thread t1(work, std::ref(c.a));
        std::thread t2(work, std::ref(c.b));
        t1.join(); t2.join();
        ll::DoNotOptimize(c.a.load());
    });

    suite.add("padded", [&](ll::State& s) {
        struct alignas(64) PaddedCounter { std::atomic<long> val{0}; };
        PaddedCounter a, b;
        auto work = [&](std::atomic<long>& counter) {
            for (size_t i = 0; i < data_size; ++i) counter.fetch_add(1, std::memory_order_relaxed);
        };
        std::thread t1(work, std::ref(a.val));
        std::thread t2(work, std::ref(b.val));
        t1.join(); t2.join();
        ll::DoNotOptimize(a.val.load());
    });

    suite.run();
    suite.report_json(std::cout);
}

void bench_pass_by_value(size_t data_size) {
    ll::BenchSuite suite("pass_by_value", 3, 20);
    suite.set_data_size(data_size);

    std::string test_str(200, 'x'); // 200-byte string to make copies expensive

    auto by_value = [](std::string s) -> size_t { return s.size(); };
    auto by_ref   = [](const std::string& s) -> size_t { return s.size(); };

    suite.add("by_value", [&](ll::State& s) {
        size_t sum = 0;
        for (size_t i = 0; i < data_size; ++i) sum += by_value(test_str);
        ll::DoNotOptimize(sum);
    });

    suite.add("by_const_ref", [&](ll::State& s) {
        size_t sum = 0;
        for (size_t i = 0; i < data_size; ++i) sum += by_ref(test_str);
        ll::DoNotOptimize(sum);
    });

    suite.run();
    suite.report_json(std::cout);
}

void bench_pow_vs_multiply(size_t data_size) {
    ll::BenchSuite suite("pow_vs_multiply", 3, 20);
    suite.set_data_size(data_size);

    std::vector<double> vals(data_size);
    for (size_t i = 0; i < data_size; ++i) vals[i] = static_cast<double>(i) * 0.001;

    // Use volatile to prevent compiler from recognizing pow(x, 2.0)
    volatile double exponent = 2.0;

    suite.add("std::pow", [&](ll::State& s) {
        double sum = 0;
        for (size_t i = 0; i < data_size; ++i) sum += std::pow(vals[i], exponent);
        ll::DoNotOptimize(sum);
    });

    suite.add("direct_multiply", [&](ll::State& s) {
        double sum = 0;
        for (size_t i = 0; i < data_size; ++i) sum += vals[i] * vals[i];
        ll::DoNotOptimize(sum);
    });

    suite.run();
    suite.report_json(std::cout);
}

void bench_endl_vs_newline(size_t data_size) {
    ll::BenchSuite suite("endl_vs_newline", 3, 10);
    suite.set_data_size(data_size);

    suite.add("std::endl", [&](ll::State& s) {
        std::ostringstream oss;
        for (size_t i = 0; i < data_size; ++i) oss << i << std::endl;
        ll::DoNotOptimize(oss.str().data());
    });

    suite.add("newline_char", [&](ll::State& s) {
        std::ostringstream oss;
        for (size_t i = 0; i < data_size; ++i) oss << i << '\n';
        ll::DoNotOptimize(oss.str().data());
    });

    suite.run();
    suite.report_json(std::cout);
}

void bench_loop_size_hoist(size_t data_size) {
    ll::BenchSuite suite("loop_size_hoist", 3, 20);
    suite.set_data_size(data_size);

    std::vector<int> data(data_size, 1);

    suite.add("size_in_loop", [&](ll::State& s) {
        volatile long sum = 0;
        for (size_t i = 0; i < data.size(); ++i) sum += data[i];
        ll::DoNotOptimize(sum);
    });

    suite.add("hoisted", [&](ll::State& s) {
        const size_t n = data.size();
        volatile long sum = 0;
        for (size_t i = 0; i < n; ++i) sum += data[i];
        ll::DoNotOptimize(sum);
    });

    suite.run();
    suite.report_json(std::cout);
}

// ── Pattern Registry ─────────────────────────────────────────────────

using BenchmarkFn = void(*)(size_t);

struct PatternEntry {
    std::string id;
    std::string name;
    BenchmarkFn fn;
};

const std::vector<PatternEntry>& get_patterns() {
    static const std::vector<PatternEntry> patterns = {
        {"map_vs_unordered",   "std::map → unordered_map",       bench_map_vs_unordered},
        {"list_vs_vector",     "std::list → std::vector",        bench_list_vs_vector},
        {"reserve_pattern",    "push_back → reserve",            bench_reserve_pattern},
        {"virtual_vs_crtp",    "Virtual → CRTP",                 bench_virtual_vs_crtp},
        {"aos_vs_soa",         "AoS → SoA",                     bench_aos_vs_soa},
        {"branch_vs_branchless","Branch → Branchless",           bench_branch_vs_branchless},
        {"shared_vs_unique",   "shared_ptr → unique_ptr",        bench_shared_vs_unique},
        {"false_sharing",      "False Sharing → Padded",         bench_false_sharing},
        {"pass_by_value",      "By Value → const&",              bench_pass_by_value},
        {"pow_vs_multiply",    "std::pow → x*x",                 bench_pow_vs_multiply},
        {"endl_vs_newline",    "std::endl → '\\n'",              bench_endl_vs_newline},
        {"loop_size_hoist",    ".size() → hoisted",              bench_loop_size_hoist},
    };
    return patterns;
}

// ── Main ─────────────────────────────────────────────────────────────

int main(int argc, char* argv[]) {
    std::string pattern_id = "all";
    size_t data_size = 100000;
    std::string scale_str;
    bool list_mode = false;
    bool table_mode = false;

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--pattern" && i + 1 < argc) pattern_id = argv[++i];
        else if (arg == "--size" && i + 1 < argc) data_size = std::stoull(argv[++i]);
        else if (arg == "--scale" && i + 1 < argc) scale_str = argv[++i];
        else if (arg == "--list") list_mode = true;
        else if (arg == "--table") table_mode = true;
        else if (arg == "--help" || arg == "-h") {
            std::cerr << "Usage: ll_bench_runner [--pattern ID|all] [--size N] [--scale 1000,10000,...] [--list] [--table]\n";
            return 0;
        }
    }

    if (list_mode) {
        std::cout << "[";
        bool first = true;
        for (auto& p : get_patterns()) {
            if (!first) std::cout << ",";
            std::cout << "{\"id\":\"" << p.id << "\",\"name\":\"" << p.name << "\"}";
            first = false;
        }
        std::cout << "]" << std::endl;
        return 0;
    }

    // Scale mode: run at multiple sizes
    if (!scale_str.empty()) {
        std::vector<size_t> sizes;
        std::istringstream iss(scale_str);
        std::string tok;
        while (std::getline(iss, tok, ',')) sizes.push_back(std::stoull(tok));

        std::cout << "{\"pattern\":\"" << pattern_id << "\",\"scale_results\":[";
        for (size_t si = 0; si < sizes.size(); ++si) {
            if (si > 0) std::cout << ",";
            std::cout << "{\"data_size\":" << sizes[si] << ",\"result\":";
            // Redirect suite output
            std::ostringstream capture;
            auto old_buf = std::cout.rdbuf(capture.rdbuf());

            for (auto& p : get_patterns()) {
                if (p.id == pattern_id) { p.fn(sizes[si]); break; }
            }

            std::cout.rdbuf(old_buf);
            std::cout << capture.str() << "}";
        }
        std::cout << "]}" << std::endl;
        return 0;
    }

    // Single pattern or all
    if (pattern_id == "all") {
        std::cout << "[";
        bool first = true;
        for (auto& p : get_patterns()) {
            if (!first) std::cout << ",";
            first = false;
            p.fn(data_size);
        }
        std::cout << "]" << std::endl;
    } else {
        for (auto& p : get_patterns()) {
            if (p.id == pattern_id) {
                p.fn(data_size);
                return 0;
            }
        }
        std::cerr << "Unknown pattern: " << pattern_id << "\n";
        std::cerr << "Available:";
        for (auto& p : get_patterns()) std::cerr << " " << p.id;
        std::cerr << "\n";
        return 1;
    }

    return 0;
}
