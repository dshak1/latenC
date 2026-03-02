cmake_minimum_required(VERSION 3.16)
project(LatencyLensEngine
    VERSION 1.0.0
    DESCRIPTION "LatencyLens C++ Performance Analysis Engine"
    LANGUAGES CXX
)

# ── C++17 required ────────────────────────────────────────────────────

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# ── Compiler warnings ────────────────────────────────────────────────

add_compile_options(
    -Wall -Wextra -Wpedantic
    -Wshadow -Wnon-virtual-dtor
    -Wold-style-cast -Wcast-align
    -Woverloaded-virtual -Wconversion
    -Wsign-conversion -Wnull-dereference
    -Wformat=2 -Wimplicit-fallthrough
)

# Treat warnings as errors in CI
option(LL_WERROR "Treat warnings as errors" OFF)
if(LL_WERROR)
    add_compile_options(-Werror)
endif()

# ── Sanitizers (debug builds) ────────────────────────────────────────

option(LL_ASAN "Enable AddressSanitizer" OFF)
option(LL_TSAN "Enable ThreadSanitizer" OFF)
option(LL_UBSAN "Enable UndefinedBehaviorSanitizer" OFF)

if(LL_ASAN)
    add_compile_options(-fsanitize=address -fno-omit-frame-pointer)
    add_link_options(-fsanitize=address)
endif()

if(LL_TSAN)
    add_compile_options(-fsanitize=thread)
    add_link_options(-fsanitize=thread)
endif()

if(LL_UBSAN)
    add_compile_options(-fsanitize=undefined)
    add_link_options(-fsanitize=undefined)
endif()

# ── Architecture-specific flags ──────────────────────────────────────

include(CheckCXXCompilerFlag)
check_cxx_compiler_flag(-march=native HAS_MARCH_NATIVE)
if(HAS_MARCH_NATIVE AND NOT CMAKE_CROSSCOMPILING)
    add_compile_options(-march=native)
endif()

# ── Header-only library target ───────────────────────────────────────

add_library(ll_headers INTERFACE)
target_include_directories(ll_headers INTERFACE ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_features(ll_headers INTERFACE cxx_std_17)

# ── Executables ──────────────────────────────────────────────────────

# Static analyzer (tokenizer-based)
add_executable(ll_analyzer ll_analyzer.cpp)
target_link_libraries(ll_analyzer PRIVATE ll_headers)

# Assembly diff / comparison tool
add_executable(ll_asmdiff ll_asmdiff.cpp)
target_link_libraries(ll_asmdiff PRIVATE ll_headers)

# Benchmark runner (all 12 anti-patterns)
add_executable(ll_bench_runner ll_bench_runner.cpp)
target_link_libraries(ll_bench_runner PRIVATE ll_headers)

# Engine test suite
add_executable(ll_engine_test ll_engine_test.cpp)
target_link_libraries(ll_engine_test PRIVATE ll_headers)
find_package(Threads REQUIRED)
target_link_libraries(ll_engine_test PRIVATE Threads::Threads)

# ── Release vs Debug configurations ──────────────────────────────────

# Release: optimize for speed
set(CMAKE_CXX_FLAGS_RELEASE "-O2 -DNDEBUG")
# RelWithDebInfo: optimized + debuggable
set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "-O2 -g -DNDEBUG")
# Debug: no opt, full debug info
set(CMAKE_CXX_FLAGS_DEBUG "-O0 -g")

# ── Testing ──────────────────────────────────────────────────────────

enable_testing()

add_test(NAME engine_tests COMMAND ll_engine_test)
set_tests_properties(engine_tests PROPERTIES TIMEOUT 30)

add_test(NAME analyzer_help COMMAND ll_analyzer --help)
add_test(NAME asmdiff_help COMMAND ll_asmdiff --help)
add_test(NAME bench_list COMMAND ll_bench_runner --list)

# Smoke test: analyze sample file
add_test(
    NAME analyzer_smoke
    COMMAND ll_analyzer --file ${CMAKE_CURRENT_SOURCE_DIR}/../examples/sample.cpp
)

# ── Install ──────────────────────────────────────────────────────────

include(GNUInstallDirs)

install(TARGETS ll_analyzer ll_asmdiff ll_bench_runner
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
)

install(FILES
    bench_harness.hpp
    arena_allocator.hpp
    spsc_queue.hpp
    constexpr_patterns.hpp
    DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/latencylens
)

# ── Summary ──────────────────────────────────────────────────────────

message(STATUS "")
message(STATUS "  LatencyLens Engine ${PROJECT_VERSION}")
message(STATUS "  ─────────────────────────────────────")
message(STATUS "  C++ Compiler: ${CMAKE_CXX_COMPILER_ID} ${CMAKE_CXX_COMPILER_VERSION}")
message(STATUS "  Build type:   ${CMAKE_BUILD_TYPE}")
message(STATUS "  ASAN:         ${LL_ASAN}")
message(STATUS "  TSAN:         ${LL_TSAN}")
message(STATUS "  UBSAN:        ${LL_UBSAN}")
message(STATUS "  Warnings:     ON (Werror: ${LL_WERROR})")
message(STATUS "")
