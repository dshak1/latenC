/**
 * LatencyLens — C++ Micro-Benchmark Harness
 * 
 * Header-only, zero-dependency benchmark framework.
 * Modern C++17 with proper statistical analysis.
 *
 * Features:
 *   - DoNotOptimize / ClobberMemory compiler barriers
 *   - Warm-up phase with configurable iterations  
 *   - Statistical output: mean, median, stddev, min, max, p95, p99
 *   - Cache-line-aware allocation helpers
 *   - JSON output for tooling integration
 *   - Templated bench runner with lambda support
 *
 * Usage:
 *   #include "bench_harness.hpp"
 *   int main() {
 *       ll::BenchSuite suite("my_benchmark");
 *       suite.add("vector_push", [](ll::State& s) {
 *           std::vector<int> v;
 *           for (auto _ : s) v.push_back(42);
 *       });
 *       suite.run();
 *       suite.report_json(std::cout);
 *   }
 */

#pragma once

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <functional>
#include <iomanip>
#include <iostream>
#include <numeric>
#include <sstream>
#include <string>
#include <vector>

#if defined(__APPLE__)
#include <mach/mach_time.h>
#include <sys/resource.h>
#elif defined(__linux__)
#include <sys/resource.h>
#endif

namespace ll {

// ── Compiler Barriers ────────────────────────────────────────────────

/**
 * Prevents the compiler from optimizing away a computed value.
 * Equivalent to Google Benchmark's DoNotOptimize.
 */
template <typename T>
inline void DoNotOptimize(T const& value) {
    asm volatile("" : : "r,m"(value) : "memory");
}

template <typename T>
inline void DoNotOptimize(T& value) {
#if defined(__clang__)
    asm volatile("" : "+r,m"(value) : : "memory");
#else
    asm volatile("" : "+m,r"(value) : : "memory");
#endif
}

/**
 * Forces the compiler to flush pending writes to memory.
 * Use after writing to data structures to prevent dead-store elimination.
 */
inline void ClobberMemory() {
    asm volatile("" : : : "memory");
}

// ── High-Resolution Timer ────────────────────────────────────────────

using Clock    = std::chrono::high_resolution_clock;
using TimePoint = Clock::time_point;
using Duration  = std::chrono::nanoseconds;

inline int64_t to_ns(Duration d) {
    return std::chrono::duration_cast<std::chrono::nanoseconds>(d).count();
}

// ── Cache-Line Utilities ────────────────────────────────────────────

#ifdef __cpp_lib_hardware_interference_size
inline constexpr std::size_t CACHE_LINE = std::hardware_destructive_interference_size;
#else
inline constexpr std::size_t CACHE_LINE = 64;
#endif

template <typename T>
struct alignas(CACHE_LINE) CacheAligned {
    T value;
    operator T&() { return value; }
    operator const T&() const { return value; }
};

// ── Statistics ──────────────────────────────────────────────────────

struct Stats {
    double mean_ns    = 0;
    double median_ns  = 0;
    double stddev_ns  = 0;
    double min_ns     = 0;
    double max_ns     = 0;
    double p95_ns     = 0;
    double p99_ns     = 0;
    double cv_pct     = 0;   // coefficient of variation
    int64_t total_ns  = 0;
    size_t  samples   = 0;

    static Stats compute(std::vector<int64_t>& timings) {
        Stats s;
        if (timings.empty()) return s;

        std::sort(timings.begin(), timings.end());
        s.samples = timings.size();

        // Remove outliers (IQR method) — discard below Q1-1.5*IQR and above Q3+1.5*IQR
        size_t n = timings.size();
        int64_t q1 = timings[n / 4];
        int64_t q3 = timings[3 * n / 4];
        int64_t iqr = q3 - q1;
        int64_t lo = q1 - static_cast<int64_t>(1.5 * iqr);
        int64_t hi = q3 + static_cast<int64_t>(1.5 * iqr);

        std::vector<int64_t> clean;
        clean.reserve(n);
        for (auto t : timings) {
            if (t >= lo && t <= hi) clean.push_back(t);
        }
        if (clean.empty()) clean = timings; // fallback

        n = clean.size();
        s.total_ns = std::accumulate(clean.begin(), clean.end(), int64_t{0});
        s.mean_ns  = static_cast<double>(s.total_ns) / n;
        s.min_ns   = static_cast<double>(clean.front());
        s.max_ns   = static_cast<double>(clean.back());
        s.median_ns = (n % 2 == 0)
            ? (clean[n/2 - 1] + clean[n/2]) / 2.0
            : static_cast<double>(clean[n/2]);

        // Percentiles
        s.p95_ns = static_cast<double>(clean[static_cast<size_t>(0.95 * (n - 1))]);
        s.p99_ns = static_cast<double>(clean[static_cast<size_t>(0.99 * (n - 1))]);

        // Standard deviation
        double var = 0;
        for (auto t : clean) {
            double diff = t - s.mean_ns;
            var += diff * diff;
        }
        s.stddev_ns = std::sqrt(var / n);
        s.cv_pct = (s.mean_ns > 0) ? (s.stddev_ns / s.mean_ns * 100.0) : 0;

        return s;
    }
};

// ── State Iterator (for idiomatic for-loop benchmarks) ───────────────

class State {
public:
    struct Iterator {
        size_t remaining;
        bool operator!=(const Iterator& other) const { return remaining != other.remaining; }
        Iterator& operator++() { --remaining; return *this; }
        size_t operator*() const { return remaining; }
    };

    explicit State(size_t iters) : iterations_(iters) {}

    Iterator begin() { return {iterations_}; }
    Iterator end()   { return {0}; }

    size_t iterations() const { return iterations_; }

    // Allow benchmarks to communicate data_size
    size_t data_size = 0;

private:
    size_t iterations_;
};

// ── Resource Usage ──────────────────────────────────────────────────

struct ResourceUsage {
    int64_t page_faults       = 0;  // minor + major
    int64_t peak_rss_bytes    = 0;  // peak resident set size
    int64_t voluntary_csw     = 0;  // voluntary context switches
    int64_t involuntary_csw   = 0;

    static ResourceUsage capture() {
        ResourceUsage u;
#if defined(__APPLE__) || defined(__linux__)
        struct rusage ru;
        if (getrusage(RUSAGE_SELF, &ru) == 0) {
            u.page_faults = ru.ru_minflt + ru.ru_majflt;
#if defined(__APPLE__)
            u.peak_rss_bytes = ru.ru_maxrss;       // bytes on macOS
#else
            u.peak_rss_bytes = ru.ru_maxrss * 1024; // KB on Linux
#endif
            u.voluntary_csw   = ru.ru_nvcsw;
            u.involuntary_csw = ru.ru_nivcsw;
        }
#endif
        return u;
    }

    static ResourceUsage diff(const ResourceUsage& before, const ResourceUsage& after) {
        ResourceUsage d;
        d.page_faults     = after.page_faults - before.page_faults;
        d.peak_rss_bytes  = after.peak_rss_bytes; // peak is absolute
        d.voluntary_csw   = after.voluntary_csw - before.voluntary_csw;
        d.involuntary_csw = after.involuntary_csw - before.involuntary_csw;
        return d;
    }
};

// ── Benchmark Result ────────────────────────────────────────────────

struct BenchResult {
    std::string name;
    Stats       stats;
    ResourceUsage resources;
    size_t      data_size = 0;
    size_t      iterations = 0;

    std::string to_json() const {
        std::ostringstream os;
        os << std::fixed << std::setprecision(2);
        os << "{"
           << "\"name\":\"" << name << "\""
           << ",\"mean_ns\":" << stats.mean_ns
           << ",\"median_ns\":" << stats.median_ns
           << ",\"stddev_ns\":" << stats.stddev_ns
           << ",\"min_ns\":" << stats.min_ns
           << ",\"max_ns\":" << stats.max_ns
           << ",\"p95_ns\":" << stats.p95_ns
           << ",\"p99_ns\":" << stats.p99_ns
           << ",\"cv_pct\":" << stats.cv_pct
           << ",\"total_ns\":" << stats.total_ns
           << ",\"samples\":" << stats.samples
           << ",\"data_size\":" << data_size
           << ",\"iterations\":" << iterations
           << ",\"page_faults\":" << resources.page_faults
           << ",\"peak_rss_bytes\":" << resources.peak_rss_bytes
           << ",\"voluntary_csw\":" << resources.voluntary_csw
           << ",\"involuntary_csw\":" << resources.involuntary_csw
           << "}";
        return os.str();
    }
};

// ── Bench Function Type ─────────────────────────────────────────────

using BenchFn = std::function<void(State&)>;

// ── Benchmark Suite ─────────────────────────────────────────────────

class BenchSuite {
public:
    explicit BenchSuite(std::string name, size_t warmup = 3, size_t runs = 30)
        : name_(std::move(name)), warmup_(warmup), runs_(runs) {}

    BenchSuite& set_data_size(size_t sz) { data_size_ = sz; return *this; }
    BenchSuite& set_iterations(size_t n) { iterations_ = n; return *this; }

    void add(const std::string& name, BenchFn fn) {
        benches_.push_back({name, std::move(fn)});
    }

    void run() {
        results_.clear();
        for (auto& [bname, fn] : benches_) {
            results_.push_back(run_one(bname, fn));
        }
    }

    const std::vector<BenchResult>& results() const { return results_; }

    // ── JSON Output ──────────────────────────────────────

    void report_json(std::ostream& os) const {
        os << "{\"suite\":\"" << name_ << "\",\"results\":[";
        for (size_t i = 0; i < results_.size(); ++i) {
            if (i > 0) os << ",";
            os << results_[i].to_json();
        }
        os << "]";

        // Compute speedup if exactly 2 benchmarks (before/after)
        if (results_.size() == 2) {
            double before = results_[0].stats.mean_ns;
            double after  = results_[1].stats.mean_ns;
            double speedup = (after > 0) ? before / after : 0;
            os << std::fixed << std::setprecision(2);
            os << ",\"speedup\":" << speedup;
            os << ",\"before_ns\":" << before;
            os << ",\"after_ns\":" << after;
        }

        os << "}" << std::endl;
    }

    // Human-readable table output
    void report_table(std::ostream& os) const {
        os << "\n╔══════════════════════════════════════════════════════════════╗\n";
        os << "║  " << std::left << std::setw(58) << name_ << "║\n";
        os << "╠══════════════════════════════════════════════════════════════╣\n";

        for (const auto& r : results_) {
            os << "║  " << std::left << std::setw(20) << r.name;
            os << std::right << std::fixed << std::setprecision(1);
            os << "  mean=" << std::setw(10) << format_ns(r.stats.mean_ns);
            os << "  σ=" << std::setw(8) << format_ns(r.stats.stddev_ns);
            os << "  p95=" << std::setw(10) << format_ns(r.stats.p95_ns);
            os << " ║\n";
        }

        if (results_.size() == 2) {
            double speedup = results_[0].stats.mean_ns / std::max(1.0, results_[1].stats.mean_ns);
            os << "╠══════════════════════════════════════════════════════════════╣\n";
            os << "║  SPEEDUP: " << std::fixed << std::setprecision(2) << speedup << "×";
            int pad = 49 - static_cast<int>(std::to_string(static_cast<int>(speedup * 100)).size());
            os << std::string(std::max(1, pad), ' ') << "║\n";
        }

        os << "╚══════════════════════════════════════════════════════════════╝\n";
    }

private:
    struct Bench {
        std::string name;
        BenchFn fn;
    };

    std::string name_;
    size_t warmup_;
    size_t runs_;
    size_t data_size_   = 100000;
    size_t iterations_  = 1;
    std::vector<Bench> benches_;
    std::vector<BenchResult> results_;

    BenchResult run_one(const std::string& bname, const BenchFn& fn) {
        // Warm-up
        for (size_t i = 0; i < warmup_; ++i) {
            State s(iterations_);
            s.data_size = data_size_;
            fn(s);
        }

        // Timed runs
        std::vector<int64_t> timings;
        timings.reserve(runs_);
        ResourceUsage res_before = ResourceUsage::capture();

        for (size_t i = 0; i < runs_; ++i) {
            State s(iterations_);
            s.data_size = data_size_;

            auto t0 = Clock::now();
            fn(s);
            auto t1 = Clock::now();

            ClobberMemory();
            timings.push_back(to_ns(t1 - t0));
        }

        ResourceUsage res_after = ResourceUsage::capture();

        BenchResult r;
        r.name       = bname;
        r.stats      = Stats::compute(timings);
        r.resources  = ResourceUsage::diff(res_before, res_after);
        r.data_size  = data_size_;
        r.iterations = iterations_;
        return r;
    }

    static std::string format_ns(double ns) {
        std::ostringstream os;
        os << std::fixed;
        if (ns >= 1e9)      os << std::setprecision(2) << ns / 1e9 << "s";
        else if (ns >= 1e6) os << std::setprecision(2) << ns / 1e6 << "ms";
        else if (ns >= 1e3) os << std::setprecision(1) << ns / 1e3 << "µs";
        else                os << std::setprecision(0) << ns << "ns";
        return os.str();
    }
};

// ── Convenience Macros ──────────────────────────────────────────────

#define LL_BENCH(suite, name, body) \
    suite.add(name, [&](ll::State& _state) { body; })

#define LL_BENCH_N(suite, name, n, body) \
    suite.add(name, [&](ll::State& _state) { for (size_t _i = 0; _i < (n); ++_i) { body; } })

} // namespace ll
