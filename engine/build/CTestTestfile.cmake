# CMake generated Testfile for 
# Source directory: /Users/diarshakimov/Downloads/opti/engine
# Build directory: /Users/diarshakimov/Downloads/opti/engine/build
# 
# This file includes the relevant testing commands required for 
# testing this directory and lists subdirectories to be tested as well.
add_test(engine_tests "/Users/diarshakimov/Downloads/opti/engine/build/ll_engine_test")
set_tests_properties(engine_tests PROPERTIES  TIMEOUT "30" _BACKTRACE_TRIPLES "/Users/diarshakimov/Downloads/opti/engine/CMakeLists.txt;100;add_test;/Users/diarshakimov/Downloads/opti/engine/CMakeLists.txt;0;")
add_test(analyzer_help "/Users/diarshakimov/Downloads/opti/engine/build/ll_analyzer" "--help")
set_tests_properties(analyzer_help PROPERTIES  _BACKTRACE_TRIPLES "/Users/diarshakimov/Downloads/opti/engine/CMakeLists.txt;103;add_test;/Users/diarshakimov/Downloads/opti/engine/CMakeLists.txt;0;")
add_test(asmdiff_help "/Users/diarshakimov/Downloads/opti/engine/build/ll_asmdiff" "--help")
set_tests_properties(asmdiff_help PROPERTIES  _BACKTRACE_TRIPLES "/Users/diarshakimov/Downloads/opti/engine/CMakeLists.txt;104;add_test;/Users/diarshakimov/Downloads/opti/engine/CMakeLists.txt;0;")
add_test(bench_list "/Users/diarshakimov/Downloads/opti/engine/build/ll_bench_runner" "--list")
set_tests_properties(bench_list PROPERTIES  _BACKTRACE_TRIPLES "/Users/diarshakimov/Downloads/opti/engine/CMakeLists.txt;105;add_test;/Users/diarshakimov/Downloads/opti/engine/CMakeLists.txt;0;")
add_test(analyzer_smoke "/Users/diarshakimov/Downloads/opti/engine/build/ll_analyzer" "--file" "/Users/diarshakimov/Downloads/opti/engine/../examples/sample.cpp")
set_tests_properties(analyzer_smoke PROPERTIES  _BACKTRACE_TRIPLES "/Users/diarshakimov/Downloads/opti/engine/CMakeLists.txt;108;add_test;/Users/diarshakimov/Downloads/opti/engine/CMakeLists.txt;0;")
