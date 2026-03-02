/**
 * LatencyLens — Assembly Comparison Tool
 * 
 * Compiles a C++ snippet at multiple optimization levels,
 * extracts assembly, and outputs a structured comparison.
 * 
 * Demonstrates understanding of:
 *   - Compiler optimization passes
 *   - x86-64 / ARM64 assembly reading
 *   - Instruction categorization (SIMD, branch, memory, compute)
 *   
 * Build:
 *   clang++ -O2 -std=c++17 ll_asmdiff.cpp -o ll_asmdiff
 *
 * Usage:
 *   ./ll_asmdiff --before before.cpp --after after.cpp [--opt O2]
 *   echo 'void f() { ... }' | ./ll_asmdiff --function f
 */

#include <algorithm>
#include <array>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <regex>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace fs = std::filesystem;

// ── Instruction Classification ───────────────────────────────────────

enum class InsnClass {
    Memory,    // load/store
    Compute,   // arithmetic, logic
    Branch,    // jmp, call, ret
    SIMD,      // vector instructions
    Nop,       // nop, alignment
    Other,
};

struct InsnInfo {
    std::string mnemonic;
    std::string full_line;
    InsnClass   cls;
    int         line_number;
};

InsnClass classify_x86(const std::string& mnemonic) {
    // Memory
    if (mnemonic.find("mov") == 0 || mnemonic.find("lea") == 0 ||
        mnemonic.find("push") == 0 || mnemonic.find("pop") == 0 ||
        mnemonic.find("load") != std::string::npos ||
        mnemonic.find("store") != std::string::npos)
        return InsnClass::Memory;

    // SIMD
    if (mnemonic[0] == 'v' || mnemonic.find("xmm") != std::string::npos ||
        mnemonic.find("ymm") != std::string::npos || mnemonic.find("zmm") != std::string::npos ||
        mnemonic.find("packed") != std::string::npos || mnemonic.find("ps") != std::string::npos ||
        mnemonic.find("pd") != std::string::npos || mnemonic.find("shuffle") != std::string::npos)
        return InsnClass::SIMD;

    // Branch
    if (mnemonic[0] == 'j' || mnemonic.find("call") == 0 || mnemonic.find("ret") == 0 ||
        mnemonic.find("bl") == 0 || mnemonic.find("br") == 0 || mnemonic == "b" ||
        mnemonic.find("cmp") == 0 || mnemonic.find("test") == 0)
        return InsnClass::Branch;

    // Nop
    if (mnemonic == "nop" || mnemonic.find(".p2align") == 0 || mnemonic.find(".cfi") == 0)
        return InsnClass::Nop;

    // Compute (everything else: add, sub, mul, xor, shl, etc.)
    return InsnClass::Compute;
}

InsnClass classify_arm(const std::string& mnemonic) {
    if (mnemonic.find("ldr") == 0 || mnemonic.find("str") == 0 || mnemonic.find("ldp") == 0 ||
        mnemonic.find("stp") == 0 || mnemonic.find("mov") == 0)
        return InsnClass::Memory;

    if (mnemonic[0] == 'f' || mnemonic[0] == 'v' || mnemonic.find("neon") != std::string::npos)
        return InsnClass::SIMD;

    if (mnemonic[0] == 'b' || mnemonic.find("bl") == 0 || mnemonic.find("ret") == 0 ||
        mnemonic.find("cb") == 0 || mnemonic.find("tb") == 0 || mnemonic.find("cmp") == 0)
        return InsnClass::Branch;

    if (mnemonic == "nop" || mnemonic.find(".cfi") == 0)
        return InsnClass::Nop;

    return InsnClass::Compute;
}

// ── Assembly Stats ───────────────────────────────────────────────────

struct AsmStats {
    int total_insns  = 0;
    int memory_ops   = 0;
    int compute_ops  = 0;
    int branch_ops   = 0;
    int simd_ops     = 0;
    int nop_ops      = 0;

    void add(InsnClass c) {
        ++total_insns;
        switch (c) {
            case InsnClass::Memory:  ++memory_ops; break;
            case InsnClass::Compute: ++compute_ops; break;
            case InsnClass::Branch:  ++branch_ops; break;
            case InsnClass::SIMD:    ++simd_ops; break;
            case InsnClass::Nop:     ++nop_ops; break;
            case InsnClass::Other:   break;
        }
    }

    std::string to_json() const {
        std::ostringstream os;
        os << "{\"total\":" << total_insns
           << ",\"memory\":" << memory_ops
           << ",\"compute\":" << compute_ops
           << ",\"branch\":" << branch_ops
           << ",\"simd\":" << simd_ops
           << ",\"nop\":" << nop_ops << "}";
        return os.str();
    }
};

// ── Compiler Interface ───────────────────────────────────────────────

std::string exec_cmd(const std::string& cmd) {
    std::array<char, 4096> buf;
    std::string result;
    FILE* pipe = popen((cmd + " 2>&1").c_str(), "r");
    if (!pipe) return "";
    while (fgets(buf.data(), buf.size(), pipe)) {
        result += buf.data();
    }
    pclose(pipe);
    return result;
}

std::string find_compiler() {
    for (auto* c : {"clang++", "g++", "c++"}) {
        std::string out = exec_cmd(std::string(c) + " --version 2>/dev/null");
        if (!out.empty() && out.find("not found") == std::string::npos) {
            return c;
        }
    }
    return "";
}

bool is_arm() {
#if defined(__aarch64__) || defined(__arm__)
    return true;
#else
    return false;
#endif
}

struct CompileResult {
    bool success;
    std::string assembly;
    std::string error;
    std::string opt_level;
};

// Forward declaration
static std::string extract_function(const std::string& full_asm, const std::string& func_name);

CompileResult compile_to_asm(const std::string& compiler, const std::string& source,
                             const std::string& opt_level = "O2",
                             const std::string& function_filter = "") {
    // Write source to temp file
    auto tmpdir = fs::temp_directory_path();
    auto src_path = tmpdir / "ll_asm_input.cpp";
    auto asm_path = tmpdir / "ll_asm_output.s";

    {
        std::ofstream ofs(src_path);
        ofs << source;
    }

    // Compile to assembly
    std::string cmd = compiler + " -" + opt_level + " -std=c++17 -S"
                    + " -fno-asynchronous-unwind-tables"   // cleaner ASM
                    + " -fno-exceptions"                    // simplify 
                    + " -fno-rtti"
                    + " -march=native"
                    + " -o " + asm_path.string()
                    + " " + src_path.string();

    std::string err = exec_cmd(cmd);

    if (!fs::exists(asm_path)) {
        return {false, "", err, opt_level};
    }

    // Read assembly
    std::ifstream ifs(asm_path);
    std::string asm_content((std::istreambuf_iterator<char>(ifs)), {});

    // Clean up
    fs::remove(src_path);
    fs::remove(asm_path);

    // If a function filter is given, extract just that function's assembly
    if (!function_filter.empty()) {
        asm_content = extract_function(asm_content, function_filter);
    }

    return {true, asm_content, "", opt_level};
}

// Extract assembly for a specific function
static std::string extract_function(const std::string& full_asm, const std::string& func_name) {
    std::istringstream iss(full_asm);
    std::string line;
    std::string result;
    bool in_func = false;

    // Match mangled or demangled function names
    while (std::getline(iss, line)) {
        // Function label — look for the function name in the label
        if (line.find(func_name) != std::string::npos && line.back() == ':') {
            in_func = true;
            result += line + "\n";
            continue;
        }

        if (in_func) {
            // End of function: next label or .cfi_endproc or ret followed by blank
            if (!line.empty() && line[0] != '\t' && line[0] != ' ' && line.back() == ':') {
                break; // next function
            }
            if (line.find(".cfi_endproc") != std::string::npos) {
                result += line + "\n";
                break;
            }
            result += line + "\n";
        }
    }

    return result.empty() ? full_asm : result;
}

// ── Assembly Parser ──────────────────────────────────────────────────

std::vector<InsnInfo> parse_assembly(const std::string& asm_content) {
    std::vector<InsnInfo> insns;
    std::istringstream iss(asm_content);
    std::string line;
    int lineno = 0;
    bool arm = is_arm();

    while (std::getline(iss, line)) {
        ++lineno;
        // Skip labels, directives, comments, blank lines
        if (line.empty()) continue;
        if (line[0] == '.' || line[0] == ';' || line[0] == '#') continue;
        if (line.back() == ':') continue; // label

        // Trim leading whitespace
        size_t start = line.find_first_not_of(" \t");
        if (start == std::string::npos) continue;
        if (line[start] == '.') continue; // directive

        std::string trimmed = line.substr(start);

        // Extract mnemonic (first word)
        size_t space = trimmed.find_first_of(" \t");
        std::string mnemonic = (space == std::string::npos) ? trimmed : trimmed.substr(0, space);

        // Skip directives that look like instructions
        if (mnemonic[0] == '.') continue;

        InsnClass cls = arm ? classify_arm(mnemonic) : classify_x86(mnemonic);
        insns.push_back({mnemonic, trimmed, cls, lineno});
    }
    return insns;
}

// ── JSON Helpers ─────────────────────────────────────────────────────

std::string escape_json(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 32);
    for (char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    char buf[8];
                    snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    out += c;
                }
        }
    }
    return out;
}

// ── Main ─────────────────────────────────────────────────────────────

int main(int argc, char* argv[]) {
    std::string before_file, after_file, opt_level = "O2", function_name;
    bool multi_opt = false;

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--before" && i + 1 < argc) before_file = argv[++i];
        else if (arg == "--after" && i + 1 < argc) after_file = argv[++i];
        else if (arg == "--opt" && i + 1 < argc) opt_level = argv[++i];
        else if (arg == "--function" && i + 1 < argc) function_name = argv[++i];
        else if (arg == "--multi-opt") multi_opt = true;
        else if (arg == "--help" || arg == "-h") {
            std::cerr << "Usage: ll_asmdiff --before before.cpp --after after.cpp [--opt O2] [--function name] [--multi-opt]\n"
                      << "  --multi-opt: Compare O0, O1, O2, O3 for the --before file\n"
                      << "  Reads from stdin if --before not given\n";
            return 0;
        }
    }

    std::string compiler = find_compiler();
    if (compiler.empty()) {
        std::cerr << "Error: no C++ compiler found\n";
        return 1;
    }

    // Read before source
    std::string before_src;
    if (!before_file.empty()) {
        std::ifstream ifs(before_file);
        before_src = std::string(std::istreambuf_iterator<char>(ifs), {});
    } else {
        before_src = std::string(std::istreambuf_iterator<char>(std::cin), {});
    }

    if (before_src.empty()) {
        std::cerr << "Error: empty input\n";
        return 1;
    }

    std::cout << "{";

    if (multi_opt) {
        // Compare across optimization levels
        std::cout << "\"mode\":\"multi-opt\",\"results\":[";
        const char* opts[] = {"O0", "O1", "O2", "O3"};
        for (int i = 0; i < 4; ++i) {
            if (i > 0) std::cout << ",";
            auto r = compile_to_asm(compiler, before_src, opts[i], function_name);
            auto insns = parse_assembly(r.assembly);
            AsmStats stats;
            for (auto& ins : insns) stats.add(ins.cls);

            std::cout << "{\"opt\":\"" << opts[i] << "\"";
            std::cout << ",\"success\":" << (r.success ? "true" : "false");
            std::cout << ",\"stats\":" << stats.to_json();
            std::cout << ",\"assembly\":\"" << escape_json(r.assembly) << "\"";
            if (!r.error.empty()) std::cout << ",\"error\":\"" << escape_json(r.error) << "\"";
            std::cout << "}";
        }
        std::cout << "]";
    } else {
        // Before/after comparison
        auto r_before = compile_to_asm(compiler, before_src, opt_level, function_name);
        auto insns_before = parse_assembly(r_before.assembly);
        AsmStats stats_before;
        for (auto& ins : insns_before) stats_before.add(ins.cls);

        std::cout << "\"mode\":\"diff\",\"opt\":\"" << opt_level << "\"";
        std::cout << ",\"compiler\":\"" << compiler << "\"";
        std::cout << ",\"arch\":\"" << (is_arm() ? "arm64" : "x86_64") << "\"";

        std::cout << ",\"before\":{";
        std::cout << "\"stats\":" << stats_before.to_json();
        std::cout << ",\"assembly\":\"" << escape_json(r_before.assembly) << "\"";
        if (!r_before.error.empty()) std::cout << ",\"error\":\"" << escape_json(r_before.error) << "\"";
        std::cout << "}";

        if (!after_file.empty()) {
            std::ifstream ifs(after_file);
            std::string after_src(std::istreambuf_iterator<char>(ifs), {});
            auto r_after = compile_to_asm(compiler, after_src, opt_level, function_name);
            auto insns_after = parse_assembly(r_after.assembly);
            AsmStats stats_after;
            for (auto& ins : insns_after) stats_after.add(ins.cls);

            std::cout << ",\"after\":{";
            std::cout << "\"stats\":" << stats_after.to_json();
            std::cout << ",\"assembly\":\"" << escape_json(r_after.assembly) << "\"";
            if (!r_after.error.empty()) std::cout << ",\"error\":\"" << escape_json(r_after.error) << "\"";
            std::cout << "}";

            // Compute delta
            std::cout << ",\"delta\":{";
            std::cout << "\"total\":" << (stats_after.total_insns - stats_before.total_insns);
            std::cout << ",\"memory\":" << (stats_after.memory_ops - stats_before.memory_ops);
            std::cout << ",\"branch\":" << (stats_after.branch_ops - stats_before.branch_ops);
            std::cout << ",\"simd\":" << (stats_after.simd_ops - stats_before.simd_ops);
            std::cout << "}";
        }
    }

    std::cout << "}" << std::endl;
    return 0;
}
