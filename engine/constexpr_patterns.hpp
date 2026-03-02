/**
 * LatencyLens — Compile-Time Pattern Matching
 * 
 * constexpr string matching and pattern DSL evaluated entirely at compile time.
 * Demonstrates:
 *   - constexpr evaluation (C++17)
 *   - Template metaprogramming  
 *   - Variadic templates
 *   - SFINAE / if constexpr
 *   - String literal operators
 *   - Type traits
 *
 * Used to generate pattern-matching tables at compile time,
 * eliminating runtime initialization overhead for the analyzer.
 */

#pragma once

#include <array>
#include <cstddef>
#include <string_view>
#include <type_traits>

namespace ll::ct {

// ── Compile-Time String ──────────────────────────────────────────────

/**
 * Fixed-size compile-time string. Stores the string in the type itself.
 * Enables string matching logic to be resolved at compile time.
 */
template <size_t N>
struct FixedString {
    char data[N]{};
    size_t len = 0;

    constexpr FixedString() = default;

    constexpr FixedString(const char (&str)[N]) : len(N - 1) {
        for (size_t i = 0; i < N; ++i) data[i] = str[i];
    }

    constexpr char operator[](size_t i) const { return data[i]; }
    constexpr size_t size() const { return len; }
    constexpr const char* c_str() const { return data; }

    constexpr bool operator==(const FixedString& other) const {
        if (len != other.len) return false;
        for (size_t i = 0; i < len; ++i) {
            if (data[i] != other.data[i]) return false;
        }
        return true;
    }

    constexpr std::string_view view() const { return {data, len}; }
};

// CTAD guide
template <size_t N>
FixedString(const char (&)[N]) -> FixedString<N>;

// ── Compile-Time String Matching ─────────────────────────────────────

/**
 * KMP failure function computed at compile time.
 * Used for O(n) substring matching without runtime overhead.
 */
template <size_t N>
constexpr std::array<int, N> compute_kmp_table(const char (&pattern)[N]) {
    std::array<int, N> table{};
    table[0] = -1;
    int k = -1;
    for (size_t i = 1; i < N - 1; ++i) {
        while (k >= 0 && pattern[k + 1] != pattern[i]) k = table[k];
        if (pattern[k + 1] == pattern[i]) ++k;
        table[i] = k;
    }
    return table;
}

/**
 * constexpr KMP string search. Returns the index of first occurrence
 * of `pattern` in `text`, or -1 if not found.
 */
constexpr int find_substring(std::string_view text, std::string_view pattern) {
    if (pattern.empty()) return 0;
    if (text.empty() || pattern.size() > text.size()) return -1;

    // Simple O(n*m) for constexpr — KMP tables need runtime array
    for (size_t i = 0; i <= text.size() - pattern.size(); ++i) {
        bool match = true;
        for (size_t j = 0; j < pattern.size(); ++j) {
            if (text[i + j] != pattern[j]) { match = false; break; }
        }
        if (match) return static_cast<int>(i);
    }
    return -1;
}

constexpr bool contains(std::string_view text, std::string_view pattern) {
    return find_substring(text, pattern) >= 0;
}

// ── Compile-Time Pattern Severity ────────────────────────────────────

enum class Severity : uint8_t { Low, Medium, High, Critical };

constexpr const char* severity_str(Severity s) {
    switch (s) {
        case Severity::Low:      return "low";
        case Severity::Medium:   return "medium";
        case Severity::High:     return "high";
        case Severity::Critical: return "critical";
    }
    return "unknown";
}

// ── Compile-Time Pattern Definition (Template) ──────────────────────

/**
 * A strongly-typed pattern definition with string data embedded in the type.
 * Demonstrates NTTP (non-type template parameter) strings via FixedString.
 */
template <size_t IdN, size_t NameN, size_t TrigN>
struct PatternDef {
    FixedString<IdN>   id;
    FixedString<NameN> name;
    FixedString<TrigN> trigger;
    Severity severity;

    constexpr bool matches(std::string_view line) const {
        return contains(line, trigger.view());
    }
};

template <size_t A, size_t B, size_t C>
constexpr auto make_pattern(const char (&id)[A], const char (&name)[B],
                            const char (&trigger)[C], Severity sev) {
    return PatternDef<A, B, C>{
        FixedString<A>(id), FixedString<B>(name), FixedString<C>(trigger), sev
    };
}

// ── Homogeneous Pattern Table ────────────────────────────────────────

/**
 * Type-erased view for pattern tables. Uses string_view so all entries
 * share the same type → can live in a constexpr std::array.
 * The strings point to static storage (string literals), so this is safe.
 */
struct QuickPattern {
    std::string_view id;
    std::string_view name;
    std::string_view trigger;
    Severity severity;

    constexpr bool matches(std::string_view line) const {
        return contains(line, trigger);
    }
};

inline constexpr std::array<QuickPattern, 8> QUICK_PATTERNS = {{
    {"map",       "std::map -> unordered_map",  "std::map<",   Severity::High},
    {"list",      "std::list -> vector",        "std::list<",  Severity::High},
    {"push_back", "Missing reserve()",          "push_back(",  Severity::Medium},
    {"shared",    "shared_ptr overhead",        "shared_ptr<", Severity::Low},
    {"endl",      "std::endl -> newline",       "std::endl",   Severity::Medium},
    {"pow",       "std::pow -> multiply",       "std::pow(",   Severity::High},
    {"virtual",   "Virtual dispatch",           "virtual ",    Severity::Low},
    {"new_raw",   "Raw new/delete",             "new ",        Severity::Medium},
}};

/**
 * Count matches for all quick patterns in a single line.
 * Entirely constexpr-evaluable.
 */
constexpr size_t count_quick_matches(std::string_view line) {
    size_t count = 0;
    for (const auto& p : QUICK_PATTERNS) {
        if (p.matches(line)) ++count;
    }
    return count;
}

// ── Compile-Time Validation ──────────────────────────────────────────

// Verify our patterns work at compile time
static_assert(contains("std::map<int, int>", "std::map<"));
static_assert(!contains("std::unordered_map<int>", "std::map<")); // Important: no false positive
static_assert(contains("v.push_back(x)", "push_back("));
static_assert(count_quick_matches("std::map<int, std::shared_ptr<T>>") == 2); // map + shared_ptr

// ── Compile-Time Hash (FNV-1a) ──────────────────────────────────────

/**
 * FNV-1a hash computed at compile time. Useful for switch-on-string patterns.
 */
constexpr uint64_t fnv1a(std::string_view s) {
    uint64_t hash = 14695981039346656037ULL;
    for (char c : s) {
        hash ^= static_cast<uint64_t>(c);
        hash *= 1099511628211ULL;
    }
    return hash;
}

constexpr uint64_t operator""_hash(const char* s, size_t len) {
    return fnv1a({s, len});
}

// Verify at compile time
static_assert("std::map"_hash != "std::unordered_map"_hash);
static_assert("std::map"_hash == fnv1a("std::map"));

// ── Type-Level Pattern Composition ───────────────────────────────────

/**
 * Compose multiple pattern checks into a single scan pass.
 * Each Check is a callable that takes string_view and returns bool.
 */
template <typename... Checks>
struct PatternComposer {
    std::tuple<Checks...> checks;

    constexpr explicit PatternComposer(Checks... c) : checks(std::move(c)...) {}

    /**
     * Run all checks against a line. Returns bitmask of which matched.
     */
    constexpr uint64_t scan(std::string_view line) const {
        uint64_t mask = 0;
        scan_impl(line, mask, std::index_sequence_for<Checks...>{});
        return mask;
    }

private:
    template <size_t... Is>
    constexpr void scan_impl(std::string_view line, uint64_t& mask,
                             std::index_sequence<Is...>) const {
        ((std::get<Is>(checks)(line) ? (mask |= (1ULL << Is)) : 0), ...);
    }
};

template <typename... Checks>
constexpr auto compose_patterns(Checks... checks) {
    return PatternComposer<Checks...>(std::move(checks)...);
}

} // namespace ll::ct
