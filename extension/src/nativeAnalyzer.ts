/**
 * LatencyLens — Native C++ Analyzer Bridge
 *
 * Invokes the native C++ analysis engine (ll_analyzer) as a subprocess.
 * The C++ binary performs pattern detection and outputs JSON to stdout.
 *
 * Falls back gracefully if the binary is not compiled or unavailable.
 */

import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface NativeMatch {
    line: number;
    text: string;
    confidence?: string;
}

export interface NativeFinding {
    pattern_id: string;
    pattern_name: string;
    category: string;
    short_desc: string;
    severity: string;
    matches: NativeMatch[];
}

/** Parsed response from the engine — includes metadata */
interface EngineResponse {
    findings: NativeFinding[];
    token_count?: number;
    line_count?: number;
}

let cachedBinaryPath: string | null | undefined = undefined;

/**
 * Find the ll_analyzer binary. Checks:
 * 1. Pre-compiled in extension/cpp/
 * 2. Engine build directory (engine/build/ or engine/)
 * 3. On PATH
 */
export function findAnalyzerBinary(extensionPath: string): string | null {
    if (cachedBinaryPath !== undefined) { return cachedBinaryPath; }

    // Check extension/cpp/ directory
    const localBinary = path.join(extensionPath, 'cpp', 'll_analyzer');
    if (fs.existsSync(localBinary)) {
        try {
            fs.accessSync(localBinary, fs.constants.X_OK);
            cachedBinaryPath = localBinary;
            return cachedBinaryPath;
        } catch { /* not executable */ }
    }

    // Check engine/ build directories (project root is one level up from extension)
    const projectRoot = path.dirname(extensionPath);
    const enginePaths = [
        path.join(projectRoot, 'engine', 'build', 'll_analyzer'),
        path.join(projectRoot, 'engine', 'll_analyzer'),
    ];
    for (const p of enginePaths) {
        if (fs.existsSync(p)) {
            try {
                fs.accessSync(p, fs.constants.X_OK);
                cachedBinaryPath = p;
                return cachedBinaryPath;
            } catch { /* not executable */ }
        }
    }

    // Check on PATH
    try {
        const which = cp.execSync('which ll_analyzer 2>/dev/null', { timeout: 3000 });
        const p = which.toString().trim();
        if (p) {
            cachedBinaryPath = p;
            return cachedBinaryPath;
        }
    } catch { /* not found */ }

    cachedBinaryPath = null;
    return null;
}

/**
 * Compile the C++ analyzer from source if possible.
 * Returns the path to the compiled binary, or null if compilation fails.
 */
export function compileAnalyzer(extensionPath: string): string | null {
    const srcPath = path.join(extensionPath, 'cpp', 'analyzer.cpp');
    const binPath = path.join(extensionPath, 'cpp', 'll_analyzer');

    if (!fs.existsSync(srcPath)) { return null; }

    // Find a compiler
    const compilers = ['clang++', 'g++', 'c++'];
    for (const compiler of compilers) {
        try {
            cp.execSync(`which ${compiler} 2>/dev/null`, { timeout: 3000 });
            const cmd = `${compiler} -O2 -std=c++17 -o "${binPath}" "${srcPath}"`;
            cp.execSync(cmd, { timeout: 30000, stdio: 'pipe' });
            cachedBinaryPath = binPath;
            console.log(`LatencyLens: compiled native analyzer with ${compiler}`);
            return binPath;
        } catch {
            continue;
        }
    }
    return null;
}

/**
 * Check if the native C++ analyzer is available.
 */
export function hasNativeAnalyzer(extensionPath: string): boolean {
    return findAnalyzerBinary(extensionPath) !== null;
}

/**
 * Run the native C++ analyzer on source code.
 * Passes code via stdin for security and simplicity.
 * Handles both engine format ({findings:[...]}) and legacy format ([...]).
 */
export function analyzeWithNative(extensionPath: string, sourceCode: string): NativeFinding[] | null {
    const binary = findAnalyzerBinary(extensionPath);
    if (!binary) { return null; }

    try {
        const result = cp.execSync(`"${binary}"`, {
            input: sourceCode,
            timeout: 10000,
            maxBuffer: 10 * 1024 * 1024,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        const parsed = JSON.parse(result.toString());

        // Engine format: { findings: [...], token_count, line_count }
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.findings)) {
            return parsed.findings as NativeFinding[];
        }

        // Legacy format: bare array [...]
        if (Array.isArray(parsed)) {
            return parsed as NativeFinding[];
        }

        return null;
    } catch (e) {
        console.error('LatencyLens: native analyzer failed:', e);
        return null;
    }
}

/**
 * Initialize the native analyzer: compile if needed, verify it works.
 */
export function initNativeAnalyzer(extensionPath: string): boolean {
    // First check if already compiled
    if (findAnalyzerBinary(extensionPath)) {
        console.log('LatencyLens: native C++ analyzer found');
        return true;
    }

    // Try to compile
    const compiled = compileAnalyzer(extensionPath);
    if (compiled) {
        console.log('LatencyLens: native C++ analyzer compiled successfully');
        return true;
    }

    console.log('LatencyLens: native C++ analyzer not available, using TypeScript fallback');
    return false;
}

// ── Engine Tool Discovery ────────────────────────────────────────────

let cachedBenchRunner: string | null | undefined = undefined;
let cachedAsmDiff: string | null | undefined = undefined;

/**
 * Find ll_bench_runner binary in engine directory.
 */
export function findBenchRunner(extensionPath: string): string | null {
    if (cachedBenchRunner !== undefined) { return cachedBenchRunner; }

    const projectRoot = path.dirname(extensionPath);
    const candidates = [
        path.join(projectRoot, 'engine', 'build', 'll_bench_runner'),
        path.join(projectRoot, 'engine', 'll_bench_runner'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            try { fs.accessSync(p, fs.constants.X_OK); cachedBenchRunner = p; return p; } catch {}
        }
    }
    cachedBenchRunner = null;
    return null;
}

/**
 * Find ll_asmdiff binary in engine directory.
 */
export function findAsmDiff(extensionPath: string): string | null {
    if (cachedAsmDiff !== undefined) { return cachedAsmDiff; }

    const projectRoot = path.dirname(extensionPath);
    const candidates = [
        path.join(projectRoot, 'engine', 'build', 'll_asmdiff'),
        path.join(projectRoot, 'engine', 'll_asmdiff'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            try { fs.accessSync(p, fs.constants.X_OK); cachedAsmDiff = p; return p; } catch {}
        }
    }
    cachedAsmDiff = null;
    return null;
}

/**
 * Run ll_bench_runner for a specific pattern. Returns JSON with full statistics.
 */
export function runNativeBenchmark(extensionPath: string, patternId: string, dataSize?: number): any | null {
    const binary = findBenchRunner(extensionPath);
    if (!binary) { return null; }

    try {
        const args = ['--pattern', patternId, '--json'];
        if (dataSize) { args.push('--size', dataSize.toString()); }

        const result = cp.execSync(`"${binary}" ${args.join(' ')}`, {
            timeout: 60000,
            maxBuffer: 10 * 1024 * 1024,
            encoding: 'utf8',
        });

        return JSON.parse(result.toString());
    } catch (e) {
        console.error('LatencyLens: native benchmark runner failed:', e);
        return null;
    }
}

/**
 * Run ll_asmdiff for assembly comparison. Returns multi-optimization analysis.
 */
export function runAsmDiff(extensionPath: string, sourceFile: string): any | null {
    const binary = findAsmDiff(extensionPath);
    if (!binary) { return null; }

    try {
        const result = cp.execSync(`"${binary}" --multi-opt --json --file "${sourceFile}"`, {
            timeout: 30000,
            maxBuffer: 10 * 1024 * 1024,
            encoding: 'utf8',
        });

        return JSON.parse(result.toString());
    } catch (e) {
        console.error('LatencyLens: asmdiff failed:', e);
        return null;
    }
}
