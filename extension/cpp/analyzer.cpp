/**
 * LatencyLens C++ Core Analyzer
 *
 * Native C++ pattern detection engine. Reads a C++ source file,
 * detects performance anti-patterns using structural analysis,
 * and outputs results as JSON to stdout.
 *
 * This is the computational core of LatencyLens — C++ analyzing C++.
 *
 * Build:
 *   clang++ -O2 -std=c++17 -o ll_analyzer analyzer.cpp
 *
 * Usage:
 *   ./ll_analyzer <file.cpp>
 *   ./ll_analyzer --stdin   (reads from stdin)
 *
 * Output: JSON array of findings to stdout
 */

#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <regex>
#include <algorithm>
#include <unordered_map>
#include <unordered_set>
#include <functional>
#include <numeric>

// ── Data Structures ─────────────────────────────────────────

struct Match {
    int line;            // 1-based
    std::string text;    // trimmed line content
    std::string confidence; // "high", "medium", "low"
};

struct Finding {
    std::string pattern_id;
    std::string pattern_name;
    std::string category;
    std::string short_desc;
    std::string severity;
    std::vector<Match> matches;
};

// ── JSON Helpers ────────────────────────────────────────────

static std::string escape_json(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 16);
    for (char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    out += c;
                }
        }
    }
    return out;
}

static std::string finding_to_json(const Finding& f) {
    std::ostringstream os;
    os << "  {\n";
    os << "    \"pattern_id\": \"" << escape_json(f.pattern_id) << "\",\n";
    os << "    \"pattern_name\": \"" << escape_json(f.pattern_name) << "\",\n";
    os << "    \"category\": \"" << escape_json(f.category) << "\",\n";
    os << "    \"short_desc\": \"" << escape_json(f.short_desc) << "\",\n";
    os << "    \"severity\": \"" << escape_json(f.severity) << "\",\n";
    os << "    \"matches\": [\n";
    for (size_t i = 0; i < f.matches.size(); i++) {
        const auto& m = f.matches[i];
        os << "      { \"line\": " << m.line
           << ", \"text\": \"" << escape_json(m.text) << "\""
           << ", \"confidence\": \"" << m.confidence << "\" }";
        if (i + 1 < f.matches.size()) os << ",";
        os << "\n";
    }
    os << "    ]\n";
    os << "  }";
    return os.str();
}

// ── Source Helpers ───────────────────────────────────────────

struct SourceFile {
    std::vector<std::string> lines;       // raw lines
    std::vector<std::string> trimmed;     // trimmed lines
    std::vector<bool> is_comment;         // true if line is inside a comment
    std::string raw;                      // full source

    void load(const std::string& source) {
        raw = source;
        std::istringstream ss(source);
        std::string line;
        bool in_block_comment = false;

        while (std::getline(ss, line)) {
            lines.push_back(line);

            // Trim
            auto start = line.find_first_not_of(" \t\r\n");
            auto end = line.find_last_not_of(" \t\r\n");
            std::string t = (start == std::string::npos) ? "" : line.substr(start, end - start + 1);
            trimmed.push_back(t);

            // Comment tracking
            if (in_block_comment) {
                is_comment.push_back(true);
                if (t.find("*/") != std::string::npos) {
                    in_block_comment = false;
                }
            } else if (t.rfind("//", 0) == 0) {
                is_comment.push_back(true);
            } else if (t.rfind("/*", 0) == 0) {
                is_comment.push_back(true);
                if (t.find("*/") == std::string::npos) {
                    in_block_comment = true;
                }
            } else if (t.rfind("*", 0) == 0) {
                // likely inside block comment continuation
                is_comment.push_back(in_block_comment || true);
            } else {
                is_comment.push_back(false);
            }
        }
    }

    size_t size() const { return lines.size(); }
};

// ── Scope Tracking ──────────────────────────────────────────
// Lightweight brace-based scope tracker for context awareness

enum class ScopeType { GLOBAL, NAMESPACE, CLASS, STRUCT, FUNCTION, LOOP, BLOCK };

struct ScopeInfo {
    ScopeType type;
    int start_line;
    int brace_depth;
    std::string name;
};

class ScopeTracker {
    std::vector<ScopeInfo> scope_stack_;
    int brace_depth_ = 0;

public:
    void process_line(int line_idx, const std::string& trimmed) {
        // Detect scope openers
        static const std::regex class_re(R"(\b(class|struct)\s+(\w+))");
        static const std::regex func_re(R"(\w+\s+\w+\s*\([^)]*\)\s*(const)?\s*\{?)");
        static const std::regex loop_re(R"(\b(for|while|do)\s*[\({])");
        static const std::regex ns_re(R"(\bnamespace\s+(\w+)\s*\{)");

        std::smatch m;
        if (std::regex_search(trimmed, m, loop_re)) {
            // Don't push yet, wait for brace
        }

        for (char c : trimmed) {
            if (c == '{') {
                brace_depth_++;
            } else if (c == '}') {
                brace_depth_--;
                // Pop scopes that match this depth
                while (!scope_stack_.empty() && scope_stack_.back().brace_depth >= brace_depth_) {
                    scope_stack_.pop_back();
                }
            }
        }
    }

    bool is_inside_loop(int /*line_idx*/, const std::string& /*raw_source*/, const std::vector<std::string>& lines, int current_line) const {
        // Walk backwards tracking braces to see if we're in a loop
        int depth = 0;
        for (int i = current_line; i >= 0; i--) {
            const auto& line = lines[i];
            for (auto it = line.rbegin(); it != line.rend(); ++it) {
                if (*it == '}') depth++;
                else if (*it == '{') {
                    depth--;
                    if (depth < 0) {
                        // Check if this brace belongs to a loop
                        static const std::regex loop_re(R"(\b(for|while|do)\b)");
                        if (std::regex_search(lines[i], loop_re)) {
                            return true;
                        }
                        depth = 0;
                    }
                }
            }
        }
        return false;
    }

    bool is_inside_struct(const std::vector<std::string>& lines, int current_line) const {
        int depth = 0;
        for (int i = current_line; i >= 0; i--) {
            const auto& line = lines[i];
            for (auto it = line.rbegin(); it != line.rend(); ++it) {
                if (*it == '}') depth++;
                else if (*it == '{') {
                    depth--;
                    if (depth < 0) {
                        static const std::regex struct_re(R"(\b(struct|class)\s+\w+)");
                        if (std::regex_search(lines[i], struct_re)) {
                            return true;
                        }
                        depth = 0;
                    }
                }
            }
        } 
        return false;
    }
};

// ── Pattern Detectors ───────────────────────────────────────
// Each returns a vector of Match. Context-aware, skip comments.

using Detector = std::function<std::vector<Match>(const SourceFile&)>;

// 1. std::map -> std::unordered_map
std::vector<Match> detect_map_vs_unordered(const SourceFile& src) {
    std::vector<Match> matches;
    static const std::regex re(R"(\bstd\s*::\s*map\s*<)");
    for (size_t i = 0; i < src.size(); i++) {
        if (src.is_comment[i]) continue;
        // Strip trailing comment before checking for false-positive keywords
        std::string code = src.lines[i];
        auto comment_pos = code.find("//");
        if (comment_pos != std::string::npos) code = code.substr(0, comment_pos);
        if (code.find("unordered") != std::string::npos) continue;
        if (code.find("multimap") != std::string::npos) continue;
        if (std::regex_search(code, re)) {
            matches.push_back({static_cast<int>(i + 1), src.trimmed[i], "medium"});
        }
    }
    return matches;
}

// 2. std::list -> std::vector
std::vector<Match> detect_list_vs_vector(const SourceFile& src) {
    std::vector<Match> matches;
    static const std::regex re(R"(\bstd\s*::\s*list\s*<)");
    // Check if splice or merge is used (legitimate list use)
    bool has_splice = src.raw.find(".splice(") != std::string::npos
                   || src.raw.find(".merge(") != std::string::npos;
    std::string conf = has_splice ? "low" : "high";
    for (size_t i = 0; i < src.size(); i++) {
        if (src.is_comment[i]) continue;
        if (src.trimmed[i].find("forward_list") != std::string::npos) continue;
        if (std::regex_search(src.lines[i], re)) {
            matches.push_back({static_cast<int>(i + 1), src.trimmed[i], conf});
        }
    }
    return matches;
}

// 3. push_back without reserve
std::vector<Match> detect_reserve_pattern(const SourceFile& src) {
    std::vector<Match> matches;
    ScopeTracker tracker;

    // Collect all variables that have .reserve() called on them (skip comments)
    std::unordered_set<std::string> reserved_vars;
    static const std::regex reserve_re(R"((\w+)\.reserve\s*\()");
    for (size_t i = 0; i < src.size(); i++) {
        if (src.is_comment[i]) continue;
        // Strip trailing comment
        std::string code = src.lines[i];
        auto cpos = code.find("//");
        if (cpos != std::string::npos) code = code.substr(0, cpos);
        std::smatch m;
        if (std::regex_search(code, m, reserve_re)) {
            reserved_vars.insert(m[1].str());
        }
    }

    // Find push_back inside loops where the variable was not reserved
    static const std::regex pb_re(R"((\w+)\.push_back\s*\()");
    for (size_t i = 0; i < src.size(); i++) {
        if (src.is_comment[i]) continue;
        std::smatch m;
        std::string line = src.lines[i];
        if (std::regex_search(line, m, pb_re)) {
            std::string var = m[1].str();
            if (reserved_vars.count(var)) continue;
            // Check if inside a loop by scanning backwards for enclosing for/while/do
            bool in_loop = false;
            int depth = 0;
            for (int j = static_cast<int>(i) - 1; j >= 0 && !in_loop; j--) {
                const auto& prev = src.lines[j];
                for (auto it = prev.rbegin(); it != prev.rend(); ++it) {
                    if (*it == '}') depth++;
                    else if (*it == '{') {
                        if (depth > 0) { depth--; }
                        else {
                            // This opening brace might belong to a loop
                            static const std::regex loop_kw(R"(\b(for|while|do)\b)");
                            if (std::regex_search(prev, loop_kw)) {
                                in_loop = true;
                            }
                            break;
                        }
                    }
                }
            }
            if (in_loop) {
                matches.push_back({static_cast<int>(i + 1), src.trimmed[i], "medium"});
            }
        }
    }
    return matches;
}

// 4. Virtual dispatch
std::vector<Match> detect_virtual_dispatch(const SourceFile& src) {
    std::vector<Match> matches;
    static const std::regex re(R"(\bvirtual\s+\w+)");
    for (size_t i = 0; i < src.size(); i++) {
        if (src.is_comment[i]) continue;
        if (std::regex_search(src.lines[i], re)) {
            // Skip destructors (virtual dtor is good practice)
            if (src.trimmed[i].find("~") != std::string::npos) continue;
            matches.push_back({static_cast<int>(i + 1), src.trimmed[i], "low"});
        }
    }
    // Flag if any virtual methods found (even 1 indicates vtable overhead)
    return matches;
}

// 5. AoS -> SoA
std::vector<Match> detect_aos_soa(const SourceFile& src) {
    std::vector<Match> matches;
    // Find structs with 4+ numeric fields
    static const std::regex struct_re(R"(\b(struct|class)\s+(\w+)\s*\{?)");
    static const std::regex field_re(R"(\b(int|float|double|long|short|char|unsigned|size_t|uint\d+_t|int\d+_t)\s+\w+)");
    std::unordered_map<std::string, std::pair<int, int>> struct_fields; // name -> {line, count}

    for (size_t i = 0; i < src.size(); i++) {
        if (src.is_comment[i]) continue;
        std::smatch m;
        if (std::regex_search(src.lines[i], m, struct_re)) {
            std::string name = m[2].str();
            int field_count = 0;
            int depth = 0;
            for (size_t j = i; j < src.size(); j++) {
                for (char c : src.lines[j]) {
                    if (c == '{') depth++;
                    else if (c == '}') depth--;
                }
                if (depth > 0 && std::regex_search(src.lines[j], field_re)) {
                    field_count++;
                }
                if (depth == 0 && j > i) break;
            }
            if (field_count >= 4) {
                struct_fields[name] = {static_cast<int>(i + 1), field_count};
            }
        }
    }

    // Check if these structs are used in vectors
    for (const auto& [name, info] : struct_fields) {
        std::string pattern = "vector<" + name;
        std::string pattern2 = "vector<" + name + ">";
        for (size_t i = 0; i < src.size(); i++) {
            if (src.lines[i].find(pattern) != std::string::npos) {
                std::string conf = info.second >= 6 ? "high" : "medium";
                matches.push_back({info.first, src.trimmed[info.first - 1], conf});
                break;
            }
        }
    }
    return matches;
}

// 6. Branch -> branchless
std::vector<Match> detect_branch_vs_branchless(const SourceFile& src) {
    std::vector<Match> matches;
    ScopeTracker tracker;
    static const std::regex if_re(R"(\bif\s*\()");
    static const std::regex compare_re(R"([<>=!]+)");
    static const std::regex array_re(R"(\[.*\])");

    for (size_t i = 0; i < src.size(); i++) {
        if (src.is_comment[i]) continue;
        if (!std::regex_search(src.trimmed[i], if_re)) continue;
        if (!tracker.is_inside_loop(0, src.raw, src.lines, static_cast<int>(i))) continue;

        // Check if it's a simple comparison with array access
        if (std::regex_search(src.trimmed[i], compare_re) &&
            std::regex_search(src.trimmed[i], array_re)) {
            // Check for else clause (more likely branchless candidate)
            bool has_else = false;
            for (size_t j = i + 1; j < std::min(i + 5, src.size()); j++) {
                if (src.trimmed[j].find("else") != std::string::npos) {
                    has_else = true;
                    break;
                }
            }
            matches.push_back({static_cast<int>(i + 1), src.trimmed[i], has_else ? "medium" : "low"});
        }
    }
    return matches;
}

// 7. shared_ptr -> unique_ptr
std::vector<Match> detect_shared_vs_unique(const SourceFile& src) {
    std::vector<Match> matches;
    static const std::regex re(R"(\bstd\s*::\s*shared_ptr\s*<)");
    for (size_t i = 0; i < src.size(); i++) {
        if (src.is_comment[i]) continue;
        if (std::regex_search(src.lines[i], re)) {
            matches.push_back({static_cast<int>(i + 1), src.trimmed[i], "medium"});
        }
    }
    return matches;
}

// 8. False sharing
std::vector<Match> detect_false_sharing(const SourceFile& src) {
    std::vector<Match> matches;
    ScopeTracker tracker;

    // Find structs/classes with multiple atomics
    static const std::regex struct_re(R"(\b(struct|class)\s+\w+)");
    static const std::regex atomic_re(R"(\bstd\s*::\s*atomic\b|atomic<)");

    for (size_t i = 0; i < src.size(); i++) {
        if (src.is_comment[i]) continue;
        if (!std::regex_search(src.lines[i], struct_re)) continue;

        int depth = 0;
        int atomic_count = 0;
        bool has_alignas = false;
        std::vector<int> atomic_lines;

        for (size_t j = i; j < src.size(); j++) {
            for (char c : src.lines[j]) {
                if (c == '{') depth++;
                else if (c == '}') depth--;
            }
            if (std::regex_search(src.lines[j], atomic_re)) {
                atomic_count++;
                atomic_lines.push_back(static_cast<int>(j + 1));
            }
            if (src.lines[j].find("alignas") != std::string::npos) {
                has_alignas = true;
            }
            if (depth == 0 && j > i) break;
        }

        if (atomic_count >= 2 && !has_alignas) {
            for (int line : atomic_lines) {
                matches.push_back({line, src.trimmed[line - 1], "high"});
            }
        }
    }
    return matches;
}

// 9. Pass by value
std::vector<Match> detect_pass_by_value(const SourceFile& src) {
    std::vector<Match> matches;
    static const std::regex func_re(R"(\w+\s+\w+\s*\()");
    static const std::vector<std::string> containers = {
        "vector", "string", "map", "unordered_map", "set", "unordered_set", "list", "deque"
    };

    for (size_t i = 0; i < src.size(); i++) {
        if (src.is_comment[i]) continue;
        if (!std::regex_search(src.lines[i], func_re)) continue;

        for (const auto& ct : containers) {
            // Match std::container<...> param (no & or *)
            std::string pattern_str = "std::" + ct;
            auto pos = src.lines[i].find(pattern_str);
            if (pos == std::string::npos) continue;

            // Check no reference or pointer after the type
            auto rest = src.lines[i].substr(pos);
            // Find the closing > for template params, then check param name
            auto gt = rest.find('>');
            if (gt == std::string::npos) continue;
            auto after_type = rest.substr(gt + 1);
            // If there's a space then identifier but no &, it's by value
            if (after_type.find('&') == std::string::npos && after_type.find('*') == std::string::npos) {
                matches.push_back({static_cast<int>(i + 1), src.trimmed[i], "high"});
                break;
            }
        }
    }
    return matches;
}

// 10. std::pow -> multiply
std::vector<Match> detect_pow_vs_multiply(const SourceFile& src) {
    std::vector<Match> matches;
    static const std::regex re(R"(\b(std\s*::\s*)?pow\s*\([^,]+,\s*[234](\.0)?\s*\))");
    for (size_t i = 0; i < src.size(); i++) {
        if (src.is_comment[i]) continue;
        if (std::regex_search(src.lines[i], re)) {
            matches.push_back({static_cast<int>(i + 1), src.trimmed[i], "high"});
        }
    }
    return matches;
}

// 11. std::endl -> "\n"
std::vector<Match> detect_endl_vs_newline(const SourceFile& src) {
    std::vector<Match> matches;
    ScopeTracker tracker;
    static const std::regex re(R"(\b(std\s*::\s*)?endl\b)");
    for (size_t i = 0; i < src.size(); i++) {
        if (src.is_comment[i]) continue;
        if (src.trimmed[i].find("endline") != std::string::npos) continue;
        if (std::regex_search(src.lines[i], re)) {
            bool in_loop = tracker.is_inside_loop(0, src.raw, src.lines, static_cast<int>(i));
            matches.push_back({static_cast<int>(i + 1), src.trimmed[i], in_loop ? "high" : "low"});
        }
    }
    return matches;
}

// 12. Loop .size() hoisting
std::vector<Match> detect_loop_size_hoist(const SourceFile& src) {
    std::vector<Match> matches;
    static const std::regex re(R"(for\s*\([^;]*;\s*\w+\s*[<>=!]+\s*\w+\.\s*size\s*\(\s*\))");
    for (size_t i = 0; i < src.size(); i++) {
        if (src.is_comment[i]) continue;
        if (std::regex_search(src.lines[i], re)) {
            matches.push_back({static_cast<int>(i + 1), src.trimmed[i], "medium"});
        }
    }
    return matches;
}

// 13. using namespace std
std::vector<Match> detect_using_namespace_std(const SourceFile& src) {
    std::vector<Match> matches;
    static const std::regex re(R"(\busing\s+namespace\s+std\s*;)");
    ScopeTracker tracker;
    for (size_t i = 0; i < src.size(); i++) {
        if (src.is_comment[i]) continue;
        if (std::regex_search(src.lines[i], re)) {
            // Higher confidence at file scope
            bool in_func = tracker.is_inside_loop(0, src.raw, src.lines, static_cast<int>(i)); // reuse scope check
            matches.push_back({static_cast<int>(i + 1), src.trimmed[i], in_func ? "low" : "high"});
        }
    }
    return matches;
}

// 14. raw new/delete
std::vector<Match> detect_raw_new_delete(const SourceFile& src) {
    std::vector<Match> matches;
    static const std::regex re(R"(\b(new\s+\w+|delete\s+\w+|delete\s*\[\s*\]))");
    for (size_t i = 0; i < src.size(); i++) {
        if (src.is_comment[i]) continue;
        if (src.trimmed[i].find("make_unique") != std::string::npos) continue;
        if (src.trimmed[i].find("make_shared") != std::string::npos) continue;
        if (src.trimmed[i].find("operator new") != std::string::npos) continue;
        if (src.trimmed[i].find("operator delete") != std::string::npos) continue;
        if (std::regex_search(src.lines[i], re)) {
            matches.push_back({static_cast<int>(i + 1), src.trimmed[i], "high"});
        }
    }
    return matches;
}

// 15. return std::move (prevents NRVO)
std::vector<Match> detect_return_std_move(const SourceFile& src) {
    std::vector<Match> matches;
    static const std::regex re(R"(\breturn\s+std\s*::\s*move\s*\()");
    for (size_t i = 0; i < src.size(); i++) {
        if (src.is_comment[i]) continue;
        if (std::regex_search(src.lines[i], re)) {
            matches.push_back({static_cast<int>(i + 1), src.trimmed[i], "high"});
        }
    }
    return matches;
}

// 16. missing make_unique/make_shared
std::vector<Match> detect_missing_make_unique(const SourceFile& src) {
    std::vector<Match> matches;
    static const std::regex re(R"(\b(unique_ptr|shared_ptr)\s*<[^>]+>\s*\(\s*new\b)");
    for (size_t i = 0; i < src.size(); i++) {
        if (src.is_comment[i]) continue;
        if (std::regex_search(src.lines[i], re)) {
            matches.push_back({static_cast<int>(i + 1), src.trimmed[i], "high"});
        }
    }
    return matches;
}

// 17. exception in hot path
std::vector<Match> detect_exception_hot_path(const SourceFile& src) {
    std::vector<Match> matches;
    ScopeTracker tracker;
    static const std::regex re(R"(\btry\s*\{)");
    for (size_t i = 0; i < src.size(); i++) {
        if (src.is_comment[i]) continue;
        if (std::regex_search(src.lines[i], re)) {
            if (tracker.is_inside_loop(0, src.raw, src.lines, static_cast<int>(i))) {
                matches.push_back({static_cast<int>(i + 1), src.trimmed[i], "high"});
            }
        }
    }
    return matches;
}

// 18. dynamic_cast overhead
std::vector<Match> detect_dynamic_cast(const SourceFile& src) {
    std::vector<Match> matches;
    ScopeTracker tracker;
    static const std::regex re(R"(\bdynamic_cast\s*<)");
    for (size_t i = 0; i < src.size(); i++) {
        if (src.is_comment[i]) continue;
        if (std::regex_search(src.lines[i], re)) {
            bool in_loop = tracker.is_inside_loop(0, src.raw, src.lines, static_cast<int>(i));
            matches.push_back({static_cast<int>(i + 1), src.trimmed[i], in_loop ? "high" : "medium"});
        }
    }
    return matches;
}

// 19. sync_with_stdio overhead
std::vector<Match> detect_sync_io(const SourceFile& src) {
    std::vector<Match> matches;
    static const std::regex cin_re(R"(\bstd\s*::\s*cin\s*>>)");
    bool has_sync_disable = src.raw.find("sync_with_stdio(false)") != std::string::npos;
    if (has_sync_disable) return matches;

    int cin_count = 0;
    int first_line = -1;
    for (size_t i = 0; i < src.size(); i++) {
        if (src.is_comment[i]) continue;
        if (std::regex_search(src.lines[i], cin_re)) {
            cin_count++;
            if (first_line < 0) first_line = static_cast<int>(i);
        }
    }
    if (cin_count >= 3 && first_line >= 0) {
        matches.push_back({first_line + 1, src.trimmed[first_line], "medium"});
    }
    return matches;
}

// 20. missing virtual destructor
std::vector<Match> detect_missing_virtual_dtor(const SourceFile& src) {
    std::vector<Match> matches;
    static const std::regex struct_re(R"(\b(struct|class)\s+(\w+))");
    static const std::regex virtual_re(R"(\bvirtual\s+)");
    static const std::regex vdtor_re(R"(\bvirtual\s*~)");
    static const std::regex dtor_re(R"(~\s*\w+)");

    for (size_t i = 0; i < src.size(); i++) {
        if (src.is_comment[i]) continue;
        std::smatch m;
        if (!std::regex_search(src.lines[i], m, struct_re)) continue;

        int depth = 0;
        bool has_virtual_method = false;
        bool has_virtual_dtor = false;

        for (size_t j = i; j < src.size(); j++) {
            for (char c : src.lines[j]) {
                if (c == '{') depth++;
                else if (c == '}') depth--;
            }
            if (std::regex_search(src.lines[j], vdtor_re)) has_virtual_dtor = true;
            else if (std::regex_search(src.lines[j], virtual_re) && src.lines[j].find("~") == std::string::npos) {
                has_virtual_method = true;
            }
            if (depth == 0 && j > i) break;
        }

        if (has_virtual_method && !has_virtual_dtor) {
            matches.push_back({static_cast<int>(i + 1), src.trimmed[i], "medium"});
        }
    }
    return matches;
}

// ── Pattern Registry ────────────────────────────────────────

struct PatternDef {
    std::string id;
    std::string name;
    std::string category;
    std::string short_desc;
    std::string severity;
    Detector detect;
};

static const std::vector<PatternDef> ALL_PATTERNS = {
    {"map_vs_unordered",     "std::map -> std::unordered_map",   "Data Structures",  "Tree traversal O(log n) vs hash O(1)",                 "high",   detect_map_vs_unordered},
    {"list_vs_vector",       "std::list -> std::vector",         "Cache Locality",   "Pointer chasing vs contiguous memory",                 "high",   detect_list_vs_vector},
    {"reserve_pattern",      "push_back without reserve",        "Memory Allocation","Repeated heap reallocations in loop",                   "medium", detect_reserve_pattern},
    {"virtual_vs_crtp",      "Virtual dispatch -> CRTP",         "Devirtualization", "vtable indirection in hot path",                       "medium", detect_virtual_dispatch},
    {"aos_vs_soa",           "Array of Structs -> SoA",          "Cache Optimization","Cache line waste on partial field access",             "medium", detect_aos_soa},
    {"branch_vs_branchless", "Branchy -> Branchless",            "Branch Prediction","Unpredictable branches in tight loops",                 "medium", detect_branch_vs_branchless},
    {"shared_vs_unique",     "shared_ptr -> unique_ptr",         "Smart Pointers",   "Atomic ref counting overhead when not shared",          "medium", detect_shared_vs_unique},
    {"false_sharing",        "False sharing",                    "Concurrency",      "Adjacent atomics on same cache line",                   "high",   detect_false_sharing},
    {"pass_by_value",        "Pass by value -> reference",       "Function Calls",   "Unnecessary deep copy of container",                    "high",   detect_pass_by_value},
    {"pow_vs_multiply",      "std::pow -> multiply",             "Math",             "Function call overhead for small integer powers",        "medium", detect_pow_vs_multiply},
    {"endl_vs_newline",      "std::endl -> \\n",                 "I/O",              "Unnecessary buffer flush on every line",                "low",    detect_endl_vs_newline},
    {"loop_size_hoist",      "Loop .size() hoisting",            "Loops",            "Redundant size() call on every iteration",              "low",    detect_loop_size_hoist},
    {"using_namespace_std",  "using namespace std",              "Best Practices",   "Namespace pollution, ADL surprises",                    "low",    detect_using_namespace_std},
    {"raw_new_delete",       "Raw new/delete",                   "Memory Safety",    "Manual memory management, leak risk",                   "high",   detect_raw_new_delete},
    {"return_std_move",      "return std::move (prevents NRVO)", "Move Semantics",   "Pessimizes return value optimization",                  "medium", detect_return_std_move},
    {"missing_make_unique",  "Missing make_unique/make_shared",  "Smart Pointers",   "Exception-unsafe, extra allocation",                    "medium", detect_missing_make_unique},
    {"exception_hot_path",   "Exception in hot path",            "Control Flow",     "try/catch inside tight loop",                           "high",   detect_exception_hot_path},
    {"dynamic_cast_overhead","dynamic_cast overhead",            "RTTI",             "Runtime type check cost",                                "medium", detect_dynamic_cast},
    {"sync_io_overhead",     "sync_with_stdio overhead",         "I/O",              "C/C++ stream synchronization cost",                     "low",    detect_sync_io},
    {"missing_virtual_dtor", "Missing virtual destructor",       "Memory Safety",    "Undefined behavior on polymorphic delete",               "high",   detect_missing_virtual_dtor},
};

// ── Main ────────────────────────────────────────────────────

int main(int argc, char* argv[]) {
    // Read source
    std::string source;
    if (argc >= 2 && std::string(argv[1]) == "--stdin") {
        std::ostringstream ss;
        ss << std::cin.rdbuf();
        source = ss.str();
    } else if (argc >= 2) {
        std::ifstream file(argv[1]);
        if (!file.is_open()) {
            std::cerr << "Error: cannot open " << argv[1] << "\n";
            return 1;
        }
        std::ostringstream ss;
        ss << file.rdbuf();
        source = ss.str();
    } else {
        std::cerr << "Usage: ll_analyzer <file.cpp> | ll_analyzer --stdin\n";
        return 1;
    }

    if (source.empty()) {
        std::cout << "[]" << std::endl;
        return 0;
    }

    // Parse source
    SourceFile src;
    src.load(source);

    // Run all detectors
    std::vector<Finding> findings;
    for (const auto& pat : ALL_PATTERNS) {
        auto matches = pat.detect(src);
        if (!matches.empty()) {
            // Filter: keep highest confidence matches
            std::vector<Match> high, med, low;
            for (const auto& m : matches) {
                if (m.confidence == "high") high.push_back(m);
                else if (m.confidence == "medium") med.push_back(m);
                else low.push_back(m);
            }
            auto& best = !high.empty() ? high : !med.empty() ? med : low;
            findings.push_back({pat.id, pat.name, pat.category, pat.short_desc, pat.severity, best});
        }
    }

    // Output JSON
    std::cout << "[\n";
    for (size_t i = 0; i < findings.size(); i++) {
        std::cout << finding_to_json(findings[i]);
        if (i + 1 < findings.size()) std::cout << ",";
        std::cout << "\n";
    }
    std::cout << "]\n";

    return 0;
}
