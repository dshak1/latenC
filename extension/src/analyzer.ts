/**
 * LatencyLens — Analyzer (Local)
 *
 * Pure TypeScript analyzer — no HTTP, no server, no Python dependency.
 * Uses tree-sitter for AST-based detection with regex fallback.
 */

import { analyzeCode as astAnalyze, ASTFinding, initTreeSitter, isTreeSitterReady } from './astAnalyzer';
import { runBenchmark, runScalingBenchmark, BenchmarkResult } from './benchmarkRunner';

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

    constructor(extensionPath: string) {
        this.extensionPath = extensionPath;
    }

    /**
     * Initialize tree-sitter (async, must be called once).
     * Falls back to enhanced regex if WASM files aren't available.
     */
    async init(): Promise<void> {
        this.ready = await initTreeSitter(this.extensionPath);
        if (!this.ready) {
            // Regex fallback is always available
            this.ready = true;
            console.log('LatencyLens: using enhanced regex analysis (tree-sitter WASM not found)');
        }
    }

    /**
     * Analyze C++ source code for performance anti-patterns.
     * No network call — runs entirely in-process.
     */
    analyze(code: string): Finding[] {
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
     * Run a benchmark for a specific pattern.
     * Uses local compiler if available, reference data otherwise.
     */
    async benchmark(patternId: string, dataSize?: number): Promise<BenchmarkResult> {
        return runBenchmark(patternId, dataSize);
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
        return isTreeSitterReady() ? 'tree-sitter AST' : 'enhanced regex';
    }
}
