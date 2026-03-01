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
    confidence: string;
}

export interface NativeFinding {
    pattern_id: string;
    pattern_name: string;
    category: string;
    short_desc: string;
    severity: string;
    matches: NativeMatch[];
}

let cachedBinaryPath: string | null | undefined = undefined;

/**
 * Find the ll_analyzer binary. Checks:
 * 1. Pre-compiled in extension/cpp/
 * 2. On PATH
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
 * Passes code via stdin (--stdin mode) for security and simplicity.
 */
export function analyzeWithNative(extensionPath: string, sourceCode: string): NativeFinding[] | null {
    const binary = findAnalyzerBinary(extensionPath);
    if (!binary) { return null; }

    try {
        const result = cp.execSync(`"${binary}" --stdin`, {
            input: sourceCode,
            timeout: 10000,
            maxBuffer: 10 * 1024 * 1024,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        const findings: NativeFinding[] = JSON.parse(result.toString());
        return findings;
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
