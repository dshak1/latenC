/**
 * LatencyLens — C++ Static Analyzer
 * 
 * Proper tokenization-based analysis of C++ source code.
 * Handles comments, string literals, preprocessor directives, and templates.
 * 
 * Outputs JSON findings to stdout for integration with the dashboard.
 *
 * Build:
 *   clang++ -O2 -std=c++17 ll_analyzer.cpp -o ll_analyzer
 *
 * Usage:
 *   ./ll_analyzer < source.cpp
 *   ./ll_analyzer --file path/to/source.cpp
 *   cat source.cpp | ./ll_analyzer --severity high
 */

#include <algorithm>
#include <cctype>
#include <fstream>
#include <iostream>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <variant>
#include <vector>

// ── Token Types ──────────────────────────────────────────────────────

enum class TokenKind {
    Identifier,
    Keyword,
    NumericLiteral,
    StringLiteral,
    CharLiteral,
    Punctuator,
    Preprocessor,
    Comment,
    Whitespace,
    EndOfFile,
};

struct Token {
    TokenKind   kind;
    std::string text;
    int         line;
    int         col;
};

// ── Tokenizer ────────────────────────────────────────────────────────

class Tokenizer {
public:
    explicit Tokenizer(std::string_view source)
        : src_(source), pos_(0), line_(1), col_(1) {}

    std::vector<Token> tokenize() {
        std::vector<Token> tokens;
        while (pos_ < src_.size()) {
            Token tok = next_token();
            if (tok.kind != TokenKind::Whitespace) {
                tokens.push_back(std::move(tok));
            }
        }
        tokens.push_back({TokenKind::EndOfFile, "", line_, col_});
        return tokens;
    }

private:
    std::string_view src_;
    size_t pos_;
    int line_, col_;

    char peek(size_t offset = 0) const {
        return (pos_ + offset < src_.size()) ? src_[pos_ + offset] : '\0';
    }

    char advance() {
        char c = src_[pos_++];
        if (c == '\n') { ++line_; col_ = 1; }
        else { ++col_; }
        return c;
    }

    Token next_token() {
        char c = peek();

        // Whitespace
        if (std::isspace(static_cast<unsigned char>(c))) {
            return consume_whitespace();
        }

        // Preprocessor directives
        if (c == '#' && (col_ == 1 || all_whitespace_before())) {
            return consume_preprocessor();
        }

        // Comments
        if (c == '/' && peek(1) == '/') return consume_line_comment();
        if (c == '/' && peek(1) == '*') return consume_block_comment();

        // String literals
        if (c == '"') return consume_string();
        if (c == '\'') return consume_char();

        // Raw string literals R"(...)"
        if (c == 'R' && peek(1) == '"') return consume_raw_string();

        // Numeric literals
        if (std::isdigit(static_cast<unsigned char>(c)) ||
            (c == '.' && std::isdigit(static_cast<unsigned char>(peek(1))))) {
            return consume_number();
        }

        // Identifiers / keywords
        if (std::isalpha(static_cast<unsigned char>(c)) || c == '_') {
            return consume_identifier();
        }

        // Multi-char punctuators
        return consume_punctuator();
    }

    Token consume_whitespace() {
        int start_line = line_, start_col = col_;
        while (pos_ < src_.size() && std::isspace(static_cast<unsigned char>(peek()))) {
            advance();
        }
        return {TokenKind::Whitespace, "", start_line, start_col};
    }

    Token consume_line_comment() {
        int sl = line_, sc = col_;
        std::string text;
        while (pos_ < src_.size() && peek() != '\n') {
            text += advance();
        }
        return {TokenKind::Comment, text, sl, sc};
    }

    Token consume_block_comment() {
        int sl = line_, sc = col_;
        std::string text;
        text += advance(); text += advance(); // /*
        while (pos_ < src_.size()) {
            if (peek() == '*' && peek(1) == '/') {
                text += advance(); text += advance();
                break;
            }
            text += advance();
        }
        return {TokenKind::Comment, text, sl, sc};
    }

    Token consume_preprocessor() {
        int sl = line_, sc = col_;
        std::string text;
        while (pos_ < src_.size() && peek() != '\n') {
            if (peek() == '\\' && peek(1) == '\n') {
                text += advance(); text += advance(); // line continuation
                continue;
            }
            text += advance();
        }
        return {TokenKind::Preprocessor, text, sl, sc};
    }

    Token consume_string() {
        int sl = line_, sc = col_;
        std::string text;
        text += advance(); // opening "
        while (pos_ < src_.size() && peek() != '"') {
            if (peek() == '\\') text += advance(); // escape
            text += advance();
        }
        if (pos_ < src_.size()) text += advance(); // closing "
        return {TokenKind::StringLiteral, text, sl, sc};
    }

    Token consume_raw_string() {
        int sl = line_, sc = col_;
        std::string text;
        text += advance(); // R
        text += advance(); // "
        // Delimiter
        std::string delim;
        while (pos_ < src_.size() && peek() != '(') {
            delim += peek();
            text += advance();
        }
        if (pos_ < src_.size()) text += advance(); // (
        std::string end_seq = ")" + delim + "\"";
        while (pos_ < src_.size()) {
            if (src_.substr(pos_, end_seq.size()) == end_seq) {
                for (size_t i = 0; i < end_seq.size(); ++i) text += advance();
                break;
            }
            text += advance();
        }
        return {TokenKind::StringLiteral, text, sl, sc};
    }

    Token consume_char() {
        int sl = line_, sc = col_;
        std::string text;
        text += advance(); // '
        while (pos_ < src_.size() && peek() != '\'') {
            if (peek() == '\\') text += advance();
            text += advance();
        }
        if (pos_ < src_.size()) text += advance(); // '
        return {TokenKind::CharLiteral, text, sl, sc};
    }

    Token consume_number() {
        int sl = line_, sc = col_;
        std::string text;
        // Handle hex, octal, binary prefixes
        if (peek() == '0' && (peek(1) == 'x' || peek(1) == 'X' || peek(1) == 'b' || peek(1) == 'B')) {
            text += advance(); text += advance();
        }
        while (pos_ < src_.size() &&
               (std::isalnum(static_cast<unsigned char>(peek())) || peek() == '.' || peek() == '\'' || peek() == '_')) {
            text += advance();
        }
        // Suffixes
        while (pos_ < src_.size() && (peek() == 'f' || peek() == 'F' || peek() == 'l' || peek() == 'L' ||
                                       peek() == 'u' || peek() == 'U')) {
            text += advance();
        }
        return {TokenKind::NumericLiteral, text, sl, sc};
    }

    Token consume_identifier() {
        int sl = line_, sc = col_;
        std::string text;
        while (pos_ < src_.size() && (std::isalnum(static_cast<unsigned char>(peek())) || peek() == '_')) {
            text += advance();
        }
        TokenKind kind = is_keyword(text) ? TokenKind::Keyword : TokenKind::Identifier;
        return {kind, text, sl, sc};
    }

    Token consume_punctuator() {
        int sl = line_, sc = col_;
        std::string text;
        text += advance();
        // Two/three char operators
        static const std::unordered_set<std::string> multi = {
            "<<", ">>", "->", "::", "==", "!=", "<=", ">=", "&&", "||",
            "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>=",
            "++", "--", "...", "<=>",
        };
        std::string two = text + std::string(1, peek());
        std::string three = two + std::string(1, peek(1));
        if (multi.count(three)) { text += advance(); text += advance(); }
        else if (multi.count(two)) { text += advance(); }
        return {TokenKind::Punctuator, text, sl, sc};
    }

    bool all_whitespace_before() const {
        // Check if everything before current pos on this line is whitespace
        int p = static_cast<int>(pos_) - 1;
        while (p >= 0 && src_[p] != '\n') {
            if (!std::isspace(static_cast<unsigned char>(src_[p]))) return false;
            --p;
        }
        return true;
    }

    static bool is_keyword(const std::string& s) {
        static const std::unordered_set<std::string> kw = {
            "alignas", "alignof", "auto", "bool", "break", "case", "catch", "char",
            "char8_t", "char16_t", "char32_t", "class", "concept", "const", "consteval",
            "constexpr", "constinit", "const_cast", "continue", "co_await", "co_return",
            "co_yield", "decltype", "default", "delete", "do", "double", "dynamic_cast",
            "else", "enum", "explicit", "export", "extern", "false", "float", "for",
            "friend", "goto", "if", "inline", "int", "long", "mutable", "namespace",
            "new", "noexcept", "nullptr", "operator", "private", "protected", "public",
            "register", "reinterpret_cast", "requires", "return", "short", "signed",
            "sizeof", "static", "static_assert", "static_cast", "struct", "switch",
            "template", "this", "thread_local", "throw", "true", "try", "typedef",
            "typeid", "typename", "union", "unsigned", "using", "virtual", "void",
            "volatile", "wchar_t", "while",
        };
        return kw.count(s) > 0;
    }
};

// ── Source Lines Helper ──────────────────────────────────────────────

std::vector<std::string> split_lines(const std::string& s) {
    std::vector<std::string> lines;
    std::istringstream iss(s);
    std::string line;
    while (std::getline(iss, line)) lines.push_back(line);
    return lines;
}

// ── Pattern Detectors ────────────────────────────────────────────────

struct Finding {
    std::string pattern_id;
    std::string pattern_name;
    std::string category;
    std::string severity;       // "high", "medium", "low"
    std::string explanation;
    std::string before_label;
    std::string after_label;
    std::string before_snippet;
    std::string after_snippet;
    struct Match {
        int line;
        std::string text;
    };
    std::vector<Match> matches;
};

// --- std::map → unordered_map ---
class MapDetector {
public:
    std::optional<Finding> detect(
        const std::vector<Token>& tokens,
        const std::vector<std::string>& lines
    ) {
        Finding f;
        f.pattern_id   = "map_vs_unordered";
        f.pattern_name = "std::map → std::unordered_map";
        f.category     = "Data Structures";
        f.severity     = "high";
        f.explanation  = "std::map uses a red-black tree (O(log n) lookup). If you don't need ordered iteration, "
                         "std::unordered_map uses a hash table for O(1) average lookup — typically 3-10× faster.";
        f.before_label = "std::map";
        f.after_label  = "std::unordered_map";
        f.before_snippet = "std::map<std::string, int> m;\nm[key]; // O(log n) tree traversal";
        f.after_snippet  = "std::unordered_map<std::string, int> m;\nm[key]; // O(1) hash lookup";

        // Look for std::map but NOT std::unordered_map
        for (size_t i = 0; i + 2 < tokens.size(); ++i) {
            if (tokens[i].text == "std" && tokens[i+1].text == "::" && tokens[i+2].text == "map") {
                // Check it's not preceded by "unordered_" — look at the actual identifier
                if (i >= 2 && tokens[i-1].text == "::" && tokens[i-2].text == "std") continue;
                // Check we're not inside a comment
                if (tokens[i].kind == TokenKind::Comment) continue;
                f.matches.push_back({tokens[i].line, lines[tokens[i].line - 1]});
            }
            // Also detect bare "map<" without std:: prefix (using declaration)
            if (tokens[i].kind == TokenKind::Identifier && tokens[i].text == "map" &&
                i + 1 < tokens.size() && tokens[i+1].text == "<") {
                // Make sure it's not "unordered_map"
                if (i > 0 && tokens[i-1].text == "unordered_") continue;
                f.matches.push_back({tokens[i].line, lines[tokens[i].line - 1]});
            }
        }

        // Deduplicate by line
        std::unordered_set<int> seen;
        std::vector<Finding::Match> deduped;
        for (auto& m : f.matches) {
            if (seen.insert(m.line).second) deduped.push_back(m);
        }
        f.matches = deduped;

        return f.matches.empty() ? std::nullopt : std::optional<Finding>(f);
    }
};

// --- push_back without reserve ---
class ReserveDetector {
public:
    std::optional<Finding> detect(
        const std::vector<Token>& tokens,
        const std::vector<std::string>& lines
    ) {
        Finding f;
        f.pattern_id   = "reserve_pattern";
        f.pattern_name = "push_back → reserve + push_back";
        f.category     = "Memory Allocation";
        f.severity     = "medium";
        f.explanation  = "Repeated push_back without reserve causes O(n) reallocations. If you know the "
                         "approximate size, reserve() pre-allocates memory for a single allocation.";
        f.before_label = "No reserve";
        f.after_label  = "With reserve";
        f.before_snippet = "std::vector<int> v;\nfor (...) v.push_back(x); // multiple reallocs";
        f.after_snippet  = "std::vector<int> v;\nv.reserve(n);\nfor (...) v.push_back(x); // single alloc";

        // Per-scope tracking: assign each token a unique scope instance ID so that
        // a reserve() in one function does not suppress warnings in a different function.
        // Scope 0 is the global/file scope; each '{' opens a new child scope.
        int next_scope_id = 0;
        std::vector<int> token_scope(tokens.size(), 0);
        std::unordered_map<int, int> scope_parent; // scope_id -> parent scope_id
        std::vector<int> scope_stack;
        scope_stack.push_back(0); // global scope

        for (size_t i = 0; i < tokens.size(); ++i) {
            token_scope[i] = scope_stack.back();
            if (tokens[i].text == "{") {
                int new_scope = ++next_scope_id;
                scope_parent[new_scope] = scope_stack.back();
                scope_stack.push_back(new_scope);
            } else if (tokens[i].text == "}" && scope_stack.size() > 1) {
                scope_stack.pop_back();
            }
        }

        // Collect which scope instances contain a reserve() call
        std::unordered_set<int> scopes_with_reserve;
        for (size_t i = 0; i < tokens.size(); ++i) {
            if (tokens[i].kind == TokenKind::Identifier && tokens[i].text == "reserve") {
                scopes_with_reserve.insert(token_scope[i]);
            }
        }

        // Check if a scope or any of its ancestors has reserve()
        auto has_reserve_in_scope = [&](int scope_id) {
            int s = scope_id;
            while (true) {
                if (scopes_with_reserve.count(s)) return true;
                auto it = scope_parent.find(s);
                if (it == scope_parent.end()) break;
                s = it->second;
            }
            return false;
        };

        // Flag push_back / emplace_back only if the enclosing scope has no reserve()
        for (size_t i = 0; i < tokens.size(); ++i) {
            if (tokens[i].kind == TokenKind::Identifier &&
                (tokens[i].text == "push_back" || tokens[i].text == "emplace_back")) {
                if (!has_reserve_in_scope(token_scope[i])) {
                    f.matches.push_back({tokens[i].line, lines[static_cast<size_t>(tokens[i].line - 1)]});
                }
            }
        }

        std::unordered_set<int> seen;
        std::vector<Finding::Match> deduped;
        for (auto& m : f.matches) {
            if (seen.insert(m.line).second) deduped.push_back(m);
        }
        f.matches = deduped;

        return f.matches.empty() ? std::nullopt : std::optional<Finding>(f);
    }
};

// --- Pass by value (large types) ---
class PassByValueDetector {
public:
    std::optional<Finding> detect(
        const std::vector<Token>& tokens,
        const std::vector<std::string>& lines
    ) {
        Finding f;
        f.pattern_id   = "pass_by_value";
        f.pattern_name = "Pass by Value → const Reference";
        f.category     = "Copy Elimination";
        f.severity     = "medium";
        f.explanation  = "Passing std::string, std::vector, or other heap-allocating types by value "
                         "triggers a deep copy on every call. Use const& to eliminate the copy.";
        f.before_label = "By value";
        f.after_label  = "By const&";
        f.before_snippet = "void process(std::string s) { ... }";
        f.after_snippet  = "void process(const std::string& s) { ... }";

        static const std::unordered_set<std::string> heavy_types = {
            "string", "vector", "map", "unordered_map", "set", "unordered_set",
            "deque", "list", "array", "shared_ptr", "unique_ptr",
        };

        // Look for function params: type name( heavy_type identifier )
        for (size_t i = 0; i + 2 < tokens.size(); ++i) {
            if (tokens[i].kind == TokenKind::Identifier && heavy_types.count(tokens[i].text)) {
                // Check if followed by an identifier (param name) then , or )
                size_t j = i + 1;
                // Skip template args <...>
                if (j < tokens.size() && tokens[j].text == "<") {
                    int depth = 1;
                    ++j;
                    while (j < tokens.size() && depth > 0) {
                        if (tokens[j].text == "<") ++depth;
                        if (tokens[j].text == ">") --depth;
                        ++j;
                    }
                }
                if (j < tokens.size() && tokens[j].kind == TokenKind::Identifier) {
                    // Check it's NOT preceded by const and &
                    bool is_ref = false;
                    bool is_const = false;
                    if (i > 0 && tokens[i-1].text == "&") is_ref = true;
                    if (i > 0 && tokens[i-1].text == "const") is_const = true;
                    if (i > 1 && tokens[i-2].text == "const") is_const = true;

                    if (!is_ref) {
                        // Check the next token after param name is , or )
                        size_t k = j + 1;
                        if (k < tokens.size() && (tokens[k].text == "," || tokens[k].text == ")")) {
                            f.matches.push_back({tokens[i].line, lines[tokens[i].line - 1]});
                        }
                    }
                }
            }
        }

        std::unordered_set<int> seen;
        std::vector<Finding::Match> deduped;
        for (auto& m : f.matches) {
            if (seen.insert(m.line).second) deduped.push_back(m);
        }
        f.matches = deduped;
        return f.matches.empty() ? std::nullopt : std::optional<Finding>(f);
    }
};

// --- std::endl → '\n' ---
class EndlDetector {
public:
    std::optional<Finding> detect(
        const std::vector<Token>& tokens,
        const std::vector<std::string>& lines
    ) {
        Finding f;
        f.pattern_id   = "endl_vs_newline";
        f.pattern_name = "std::endl → '\\n'";
        f.category     = "I/O Overhead";
        f.severity     = "medium";
        f.explanation  = "std::endl flushes the stream buffer after each newline, which is extremely expensive "
                         "for repeated output. Use '\\n' for just a newline character.";
        f.before_label = "std::endl";
        f.after_label  = "'\\n'";
        f.before_snippet = "std::cout << x << std::endl; // flush every line";
        f.after_snippet  = "std::cout << x << '\\n'; // no flush";

        for (size_t i = 0; i + 2 < tokens.size(); ++i) {
            if (tokens[i].text == "std" && tokens[i+1].text == "::" && tokens[i+2].text == "endl") {
                f.matches.push_back({tokens[i].line, lines[tokens[i].line - 1]});
            }
            if (tokens[i].kind == TokenKind::Identifier && tokens[i].text == "endl" &&
                (i == 0 || tokens[i-1].text == "<<")) {
                // bare endl (via using namespace std)
                f.matches.push_back({tokens[i].line, lines[tokens[i].line - 1]});
            }
        }

        std::unordered_set<int> seen;
        std::vector<Finding::Match> deduped;
        for (auto& m : f.matches) {
            if (seen.insert(m.line).second) deduped.push_back(m);
        }
        f.matches = deduped;
        return f.matches.empty() ? std::nullopt : std::optional<Finding>(f);
    }
};

// --- std::pow(x, 2) → x*x ---
class PowDetector {
public:
    std::optional<Finding> detect(
        const std::vector<Token>& tokens,
        const std::vector<std::string>& lines
    ) {
        Finding f;
        f.pattern_id   = "pow_vs_multiply";
        f.pattern_name = "std::pow(x,2) → x * x";
        f.category     = "Math Overhead";
        f.severity     = "high";
        f.explanation  = "std::pow is a general-purpose function that handles fractional exponents via "
                         "logarithms. For integer powers like x², direct multiplication is 5-10× faster.";
        f.before_label = "std::pow";
        f.after_label  = "Direct multiply";
        f.before_snippet = "double r = std::pow(x, 2.0);";
        f.after_snippet  = "double r = x * x;";

        for (size_t i = 0; i + 1 < tokens.size(); ++i) {
            if (tokens[i].kind == TokenKind::Identifier && tokens[i].text == "pow") {
                f.matches.push_back({tokens[i].line, lines[tokens[i].line - 1]});
            }
        }

        std::unordered_set<int> seen;
        std::vector<Finding::Match> deduped;
        for (auto& m : f.matches) {
            if (seen.insert(m.line).second) deduped.push_back(m);
        }
        f.matches = deduped;
        return f.matches.empty() ? std::nullopt : std::optional<Finding>(f);
    }
};

// --- shared_ptr → unique_ptr ---
class SharedPtrDetector {
public:
    std::optional<Finding> detect(
        const std::vector<Token>& tokens,
        const std::vector<std::string>& lines
    ) {
        Finding f;
        f.pattern_id   = "shared_vs_unique";
        f.pattern_name = "shared_ptr → unique_ptr";
        f.category     = "Smart Pointers";
        f.severity     = "low";
        f.explanation  = "shared_ptr has atomic reference counting overhead. If ownership isn't actually shared, "
                         "unique_ptr is zero-overhead and makes ownership semantics explicit.";
        f.before_label = "shared_ptr";
        f.after_label  = "unique_ptr";
        f.before_snippet = "std::shared_ptr<Widget> w = std::make_shared<Widget>();";
        f.after_snippet  = "std::unique_ptr<Widget> w = std::make_unique<Widget>();";

        for (size_t i = 0; i < tokens.size(); ++i) {
            if (tokens[i].kind == TokenKind::Identifier &&
                (tokens[i].text == "shared_ptr" || tokens[i].text == "make_shared")) {
                f.matches.push_back({tokens[i].line, lines[tokens[i].line - 1]});
            }
        }

        std::unordered_set<int> seen;
        std::vector<Finding::Match> deduped;
        for (auto& m : f.matches) {
            if (seen.insert(m.line).second) deduped.push_back(m);
        }
        f.matches = deduped;
        return f.matches.empty() ? std::nullopt : std::optional<Finding>(f);
    }
};

// --- virtual in hot path ---
class VirtualDetector {
public:
    std::optional<Finding> detect(
        const std::vector<Token>& tokens,
        const std::vector<std::string>& lines
    ) {
        Finding f;
        f.pattern_id   = "virtual_vs_crtp";
        f.pattern_name = "Virtual Dispatch → CRTP / std::variant";
        f.category     = "Devirtualization";
        f.severity     = "low";
        f.explanation  = "Virtual function calls prevent inlining and incur indirect branch misprediction. "
                         "CRTP or std::variant with std::visit can eliminate virtual dispatch entirely.";
        f.before_label = "virtual";
        f.after_label  = "CRTP";
        f.before_snippet = "struct Base { virtual void process() = 0; };";
        f.after_snippet  = "template<typename D> struct Base { void process() { static_cast<D*>(this)->impl(); } };";

        for (size_t i = 0; i < tokens.size(); ++i) {
            if (tokens[i].kind == TokenKind::Keyword && tokens[i].text == "virtual") {
                f.matches.push_back({tokens[i].line, lines[tokens[i].line - 1]});
            }
        }

        std::unordered_set<int> seen;
        std::vector<Finding::Match> deduped;
        for (auto& m : f.matches) {
            if (seen.insert(m.line).second) deduped.push_back(m);
        }
        f.matches = deduped;
        return f.matches.empty() ? std::nullopt : std::optional<Finding>(f);
    }
};

// --- .size() in loop condition ---
class SizeInLoopDetector {
public:
    std::optional<Finding> detect(
        const std::vector<Token>& tokens,
        const std::vector<std::string>& lines
    ) {
        Finding f;
        f.pattern_id   = "loop_size_hoist";
        f.pattern_name = ".size() in Loop → Hoist to Variable";
        f.category     = "Loop Optimization";
        f.severity     = "low";
        f.explanation  = "Calling .size() in a loop condition may prevent the compiler from hoisting it, "
                         "especially if the loop body could modify the container.";
        f.before_label = ".size() in loop";
        f.after_label  = "Hoisted";
        f.before_snippet = "for (int i = 0; i < v.size(); ++i) { ... }";
        f.after_snippet  = "const auto n = v.size();\nfor (int i = 0; i < n; ++i) { ... }";

        // Find "for" keyword, then look for ".size()" in the condition
        for (size_t i = 0; i + 5 < tokens.size(); ++i) {
            if (tokens[i].kind == TokenKind::Keyword && tokens[i].text == "for") {
                // Scan until matching )
                int depth = 0;
                bool in_condition = false;
                for (size_t j = i + 1; j < tokens.size() && j < i + 80; ++j) {
                    if (tokens[j].text == "(") { ++depth; in_condition = true; }
                    if (tokens[j].text == ")") { --depth; if (depth == 0) break; }
                    if (in_condition && tokens[j].text == "size" && j + 1 < tokens.size() && tokens[j+1].text == "(") {
                        f.matches.push_back({tokens[j].line, lines[tokens[j].line - 1]});
                    }
                }
            }
        }

        std::unordered_set<int> seen;
        std::vector<Finding::Match> deduped;
        for (auto& m : f.matches) {
            if (seen.insert(m.line).second) deduped.push_back(m);
        }
        f.matches = deduped;
        return f.matches.empty() ? std::nullopt : std::optional<Finding>(f);
    }
};

// --- std::list usage ---
class ListDetector {
public:
    std::optional<Finding> detect(
        const std::vector<Token>& tokens,
        const std::vector<std::string>& lines
    ) {
        Finding f;
        f.pattern_id   = "list_vs_vector";
        f.pattern_name = "std::list → std::vector";
        f.category     = "Cache Locality";
        f.severity     = "high";
        f.explanation  = "std::list allocates each node separately on the heap, causing cache misses on iteration. "
                         "std::vector stores elements contiguously, which is almost always faster even for insertion.";
        f.before_label = "std::list";
        f.after_label  = "std::vector";
        f.before_snippet = "std::list<int> data; // scattered heap nodes";
        f.after_snippet  = "std::vector<int> data; // contiguous cache-friendly";

        for (size_t i = 0; i + 2 < tokens.size(); ++i) {
            if (tokens[i].text == "std" && tokens[i+1].text == "::" && tokens[i+2].text == "list") {
                f.matches.push_back({tokens[i].line, lines[tokens[i].line - 1]});
            }
        }

        std::unordered_set<int> seen;
        std::vector<Finding::Match> deduped;
        for (auto& m : f.matches) {
            if (seen.insert(m.line).second) deduped.push_back(m);
        }
        f.matches = deduped;
        return f.matches.empty() ? std::nullopt : std::optional<Finding>(f);
    }
};

// ── JSON Serialization ──────────────────────────────────────────────

std::string escape_json(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 16);
    for (char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:   out += c;
        }
    }
    return out;
}

std::string finding_to_json(const Finding& f) {
    std::ostringstream os;
    os << "{";
    os << "\"pattern_id\":\"" << f.pattern_id << "\"";
    os << ",\"pattern_name\":\"" << escape_json(f.pattern_name) << "\"";
    os << ",\"category\":\"" << f.category << "\"";
    os << ",\"severity\":\"" << f.severity << "\"";
    os << ",\"explanation\":\"" << escape_json(f.explanation) << "\"";
    os << ",\"before_label\":\"" << escape_json(f.before_label) << "\"";
    os << ",\"after_label\":\"" << escape_json(f.after_label) << "\"";
    os << ",\"before_snippet\":\"" << escape_json(f.before_snippet) << "\"";
    os << ",\"after_snippet\":\"" << escape_json(f.after_snippet) << "\"";
    os << ",\"matches\":[";
    for (size_t i = 0; i < f.matches.size(); ++i) {
        if (i > 0) os << ",";
        os << "{\"line\":" << f.matches[i].line
           << ",\"text\":\"" << escape_json(f.matches[i].text) << "\"}";
    }
    os << "]}";
    return os.str();
}

// ── JSON Pretty-Printer ─────────────────────────────────────────────

std::string pretty_json(const std::string& json, int indent_width = 2) {
    std::string out;
    out.reserve(json.size() * 2);
    int depth = 0;
    bool in_string = false;

    auto newline_indent = [&]() {
        out += '\n';
        out += std::string(static_cast<size_t>(depth * indent_width), ' ');
    };

    for (size_t i = 0; i < json.size(); ++i) {
        char c = json[i];
        if (in_string) {
            out += c;
            if (c == '\\' && i + 1 < json.size()) {
                out += json[++i]; // consume escaped char
            } else if (c == '"') {
                in_string = false;
            }
        } else {
            switch (c) {
                case '"': in_string = true; out += c; break;
                case '{': case '[':
                    out += c; ++depth; newline_indent(); break;
                case '}': case ']':
                    --depth; newline_indent(); out += c; break;
                case ',':
                    out += c; newline_indent(); break;
                case ':':
                    out += ": "; break;
                default:
                    out += c; break;
            }
        }
    }
    return out;
}

// ── Main ─────────────────────────────────────────────────────────────

int main(int argc, char* argv[]) {
    // Parse args
    std::string filepath;
    std::string severity_filter;
    bool show_tokens = false;
    bool pretty = false;

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--file" && i + 1 < argc) { filepath = argv[++i]; }
        else if (arg == "--severity" && i + 1 < argc) { severity_filter = argv[++i]; }
        else if (arg == "--tokens") { show_tokens = true; }
        else if (arg == "--json-pretty") { pretty = true; }
        else if (arg == "--help" || arg == "-h") {
            std::cerr << "Usage: ll_analyzer [--file path.cpp] [--severity high|medium|low] [--tokens] [--json-pretty]\n"
                      << "  Reads from stdin if no --file given. Outputs JSON findings to stdout.\n";
            return 0;
        }
    }

    // Read source
    std::string source;
    if (!filepath.empty()) {
        std::ifstream ifs(filepath);
        if (!ifs) {
            std::cerr << "Error: cannot open " << filepath << "\n";
            return 1;
        }
        source = std::string(std::istreambuf_iterator<char>(ifs), {});
    } else {
        source = std::string(std::istreambuf_iterator<char>(std::cin), {});
    }

    if (source.empty()) {
        std::cout << "{\"findings\":[]}" << std::endl;
        return 0;
    }

    // Tokenize
    Tokenizer tokenizer(source);
    auto tokens = tokenizer.tokenize();

    if (show_tokens) {
        for (auto& t : tokens) {
            std::cerr << "[L" << t.line << ":" << t.col << " "
                      << static_cast<int>(t.kind) << "] " << t.text << "\n";
        }
    }

    auto lines = split_lines(source);

    // Run all detectors — static dispatch via std::variant avoids virtual function overhead.
    // All 9 detectors are known at compile time, so heap allocation is unnecessary.
    using AnyDetector = std::variant<
        MapDetector, ReserveDetector, PassByValueDetector,
        EndlDetector, PowDetector, SharedPtrDetector,
        VirtualDetector, SizeInLoopDetector, ListDetector
    >;
    std::vector<AnyDetector> detectors = {
        MapDetector{}, ReserveDetector{}, PassByValueDetector{},
        EndlDetector{}, PowDetector{}, SharedPtrDetector{},
        VirtualDetector{}, SizeInLoopDetector{}, ListDetector{}
    };

    std::vector<Finding> findings;
    for (auto& det : detectors) {
        std::visit([&](auto& d) {
            auto f = d.detect(tokens, lines);
            if (f) {
                if (severity_filter.empty() || f->severity == severity_filter) {
                    findings.push_back(std::move(*f));
                }
            }
        }, det);
    }

    // Output JSON
    std::ostringstream out;
    out << "{\"findings\":[";
    for (size_t i = 0; i < findings.size(); ++i) {
        if (i > 0) out << ",";
        out << finding_to_json(findings[i]);
    }
    out << "],\"token_count\":" << tokens.size()
        << ",\"line_count\":" << lines.size()
        << "}";

    std::string json = out.str();
    std::cout << (pretty ? pretty_json(json) : json) << std::endl;

    return 0;
}
