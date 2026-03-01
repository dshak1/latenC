/**
 * LatencyLens — Analyzer (Hybrid: Native C++ + TypeScript fallback)
 *
 * Tries the native C++ analyzer first (ll_analyzer binary) for pattern detection.
 * Falls back to tree-sitter AST analysis, then enhanced regex.
 * C++ analyzing C++ — the core computation runs natively.
 */

import { analyzeCode as astAnalyze, ASTFinding, initTreeSitter, isTreeSitterReady } from './astAnalyzer';
import { runBenchmark, runScalingBenchmark, BenchmarkResult, ProgressCallback } from './benchmarkRunner';
import { initNativeAnalyzer, analyzeWithNative, hasNativeAnalyzer, NativeFinding } from './nativeAnalyzer';
import { PATTERNS, getPatternById } from './patterns';

export interface Match {
    line: number;
    text: string;
}

export interface Finding {
    pattern_id: string;
    pattern_name: string;
    category: string;
    short_desc: string;
    explanation: string;
    matches: Match[];
    before_label: string;
    after_label: string;
    before_snippet: string;
    after_snippet: string;
    severity: 'high' | 'medium' | 'low';
}

export { BenchmarkResult };

export class Analyzer {
    private extensionPath: string;
    private ready: boolean = false;
    private nativeReady: boolean = false;

    constructor(extensionPath: string) {
        this.extensionPath = extensionPath;
    }

    /**
     * Initialize analysis engines in priority order:
     * 1. Native C++ analyzer (compile if needed)
     * 2. tree-sitter WASM (fallback)
     * 3. Enhanced regex (always available)
     */
    async init(): Promise<void> {
        // Try native C++ analyzer first
        this.nativeReady = initNativeAnalyzer(this.extensionPath);
        if (this.nativeReady) {
            console.log('LatencyLens: native C++ analysis engine active');
        }

        // Also init tree-sitter as fallback
        this.ready = await initTreeSitter(this.extensionPath);
        if (!this.ready) {
            this.ready = true;
            if (!this.nativeReady) {
                console.log('LatencyLens: using enhanced regex analysis (no native analyzer, no tree-sitter)');
            }
        }
    }

    /**
     * Analyze C++ source code for performance anti-patterns.
     * Priority: Native C++ -> tree-sitter AST -> enhanced regex.
     */
    analyze(code: string): Finding[] {
        // Try native C++ analyzer first
        if (this.nativeReady) {
            const nativeFindings = analyzeWithNative(this.extensionPath, code);
            if (nativeFindings && nativeFindings.length >= 0) {
                return this.mergeNativeFindings(nativeFindings, code);
            }
            console.log('LatencyLens: native analyzer returned null, falling back to TypeScript');
        }

        // Fallback to TypeScript analysis
        const astFindings = astAnalyze(code);
        return astFindings.map(f => ({
            pattern_id: f.pattern_id,
            pattern_name: f.pattern_name,
            category: f.category,
            short_desc: f.short_desc,
            explanation: f.explanation,
            matches: f.matches.map(m => ({ line: m.line, text: m.text })),
            before_label: f.before_label,
            after_label: f.after_label,
            before_snippet: f.before_snippet,
            after_snippet: f.after_snippet,
            severity: f.severity,
        }));
    }

    /**
     * Merge native C++ detection results with full pattern metadata from patterns.ts.
     * The C++ binary does detection; the TypeScript side provides explanations,
     * code snippets, and benchmark data.
     */
    private mergeNativeFindings(nativeFindings: NativeFinding[], _code: string): Finding[] {
        const findings: Finding[] = [];

        for (const nf of nativeFindings) {
            const pattern = getPatternById(nf.pattern_id);
            if (pattern) {
                findings.push({
                    pattern_id: nf.pattern_id,
                    pattern_name: pattern.name,
                    category: pattern.category,
                    short_desc: pattern.short_desc,
                    explanation: pattern.explanation,
                    matches: nf.matches.map(m => ({ line: m.line, text: m.text })),
                    before_label: pattern.before_label,
                    after_label: pattern.after_label,
                    before_snippet: pattern.before_snippet,
                    after_snippet: pattern.after_snippet,
                    severity: pattern.severity,
                });
            } else {
                // Pattern from C++ not in TypeScript registry — use native data
                findings.push({
                    pattern_id: nf.pattern_id,
                    pattern_name: nf.pattern_name,
                    category: nf.category,
                    short_desc: nf.short_desc,
                    explanation: nf.short_desc,
                    matches: nf.matches.map(m => ({ line: m.line, text: m.text })),
                    before_label: 'Before',
                    after_label: 'After',
                    before_snippet: '',
                    after_snippet: '',
                    severity: (nf.severity as 'high' | 'medium' | 'low') || 'medium',
                });
            }
        }

        return findings;
    }

    /**
     * Run a benchmark for a specific pattern.
     * Uses local compiler if available, reference data otherwise.
     */
    async benchmark(patternId: string, dataSize?: number, onProgress?: ProgressCallback): Promise<BenchmarkResult> {
        return runBenchmark(patternId, dataSize, onProgress);
    }

    /**
     * Run scaling benchmark across multiple data sizes.
     */
    async scalingBenchmark(patternId: string, sizes?: number[]): Promise<BenchmarkResult[]> {
        return runScalingBenchmark(patternId, sizes);
    }

    /**
     * Get analysis mode info.
     */
    getMode(): string {
        if (this.nativeReady) { return 'native C++'; }
        return isTreeSitterReady() ? 'tree-sitter AST' : 'enhanced regex';
    }
}
