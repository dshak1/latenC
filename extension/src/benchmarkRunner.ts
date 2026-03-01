/**
 * LatencyLens — Benchmark Runner
 *
 * Two modes:
 * 1. LOCAL: Compiles and runs real C++ benchmarks if a compiler is found.
 *    Honest about what's measured — these are the same patterns, not user code.
 * 2. REFERENCE: Returns pre-measured reference data when no compiler is available.
 *    Clearly labeled as reference data, not live measurements.
 *
 * The key improvement: benchmarks are OPTIONAL, not a prerequisite.
 * The extension works fully (detection + explanations) even without a compiler.
 */

import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getPatternById, Pattern } from './patterns';

export interface BenchmarkResult {
    before_ns: number;
    after_ns: number;
    speedup: number;
    data_size: number;
    pattern_name?: string;
    error?: string;
    source: 'local' | 'reference';
    compiler?: string;
    note?: string;
}

let cachedCompiler: string | null | undefined = undefined;
let cachedOptFlags: string[] = [];

/**
 * Find a C++ compiler on the system. Cached after first call.
 */
export function findCompiler(): string | null {
    if (cachedCompiler !== undefined) { return cachedCompiler; }

    const candidates = ['clang++', 'g++', 'c++'];
    for (const cmd of candidates) {
        try {
            const result = cp.execSync(`which ${cmd} 2>/dev/null`, { timeout: 3000 });
            if (result.toString().trim()) {
                cachedCompiler = cmd;

                // Set optimization flags
                cachedOptFlags = ['-O2', '-std=c++17', '-DNDEBUG'];
                if (os.platform() === 'darwin') {
                    cachedOptFlags.push('-march=native');
                } else if (os.platform() === 'linux') {
                    cachedOptFlags.push('-march=native', '-pthread');
                }

                return cachedCompiler;
            }
        } catch {
            continue;
        }
    }
    cachedCompiler = null;
    return null;
}

/**
 * Check if local benchmarks are available.
 */
export function hasLocalBenchmarks(): boolean {
    return findCompiler() !== null;
}

/**
 * Get compiler info for display.
 */
export function getCompilerInfo(): { compiler: string | null; platform: string; arch: string } {
    const compiler = findCompiler();
    let version = '';
    if (compiler) {
        try {
            version = cp.execSync(`${compiler} --version 2>&1 | head -1`, { timeout: 3000 }).toString().trim();
        } catch { /* noop */ }
    }
    return {
        compiler: compiler ? `${compiler} (${version})` : null,
        platform: os.platform(),
        arch: os.arch(),
    };
}

/**
 * Run a benchmark for a specific pattern.
 * Tries local compilation first, falls back to reference data.
 */
export async function runBenchmark(patternId: string, dataSize?: number): Promise<BenchmarkResult> {
    const pattern = getPatternById(patternId);
    if (!pattern) {
        return { before_ns: 0, after_ns: 0, speedup: 0, data_size: 0, error: `Pattern '${patternId}' not found`, source: 'reference' };
    }

    const compiler = findCompiler();
    if (compiler) {
        try {
            return await runLocalBenchmark(pattern, compiler, dataSize);
        } catch (e) {
            console.error('LatencyLens: local benchmark failed, using reference:', e);
        }
    }

    return getReferenceBenchmark(pattern, dataSize);
}

/**
 * Compile and run a real C++ benchmark locally.
 */
async function runLocalBenchmark(pattern: Pattern, compiler: string, dataSize?: number): Promise<BenchmarkResult> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'latencylens_'));
    const srcPath = path.join(tmpDir, 'bench.cpp');
    const binPath = path.join(tmpDir, 'bench');

    try {
        fs.writeFileSync(srcPath, pattern.benchmark_code);

        // Build compile command
        const cmd = [compiler, ...cachedOptFlags];
        if (dataSize) {
            cmd.push(`-DDATA_SIZE=${dataSize}`);
        }
        cmd.push(srcPath, '-o', binPath);

        // Compile
        const compileResult = cp.execSync(cmd.join(' '), {
            timeout: 30000,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Execute
        const runResult = cp.execSync(binPath, {
            timeout: 60000,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        const output = runResult.toString().trim();
        const data = JSON.parse(output);

        return {
            before_ns: data.before_ns,
            after_ns: data.after_ns,
            speedup: data.after_ns > 0 ? Math.round((data.before_ns / data.after_ns) * 100) / 100 : 0,
            data_size: data.data_size || dataSize || 100000,
            pattern_name: pattern.name,
            source: 'local',
            compiler: compiler,
            note: `Live benchmark on ${os.arch()}, ${compiler} -O2`,
        };
    } catch (e: any) {
        throw new Error(`Compile/run failed: ${e.message}`);
    } finally {
        // Cleanup
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch { /* noop */ }
    }
}

/**
 * Return pre-measured reference benchmark data.
 * Clearly labeled as reference — no deception.
 */
function getReferenceBenchmark(pattern: Pattern, dataSize?: number): BenchmarkResult {
    const ref = pattern.reference_benchmarks;
    // Scale reference data proportionally if a different data size is requested
    const scale = dataSize ? dataSize / ref.data_size : 1;
    return {
        before_ns: Math.round(ref.before_ns * scale),
        after_ns: Math.round(ref.after_ns * scale),
        speedup: ref.speedup,
        data_size: dataSize || ref.data_size,
        pattern_name: pattern.name,
        source: 'reference',
        note: `Reference data: ${ref.note}. Install clang++/g++ for live benchmarks on your hardware.`,
    };
}

/**
 * Run scaling benchmark across multiple data sizes.
 */
export async function runScalingBenchmark(patternId: string, sizes?: number[]): Promise<BenchmarkResult[]> {
    const defaultSizes = [1000, 5000, 10000, 50000, 100000, 500000, 1000000];
    const targetSizes = sizes || defaultSizes;
    const results: BenchmarkResult[] = [];

    for (const size of targetSizes) {
        const result = await runBenchmark(patternId, size);
        results.push(result);
    }

    return results;
}
