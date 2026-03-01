/**
 * LatencyLens — CodeLens Provider
 * 
 * Shows "⚡ Run Benchmark" above lines with detected anti-patterns.
 */

import * as vscode from 'vscode';
import { Finding } from './analyzer';

/** Emitter that triggers CodeLens refresh — fire after analysis */
export const lensChangeEmitter = new vscode.EventEmitter<void>();

export class LensProvider implements vscode.CodeLensProvider {
    private findings: Map<string, Finding[]>;

    onDidChangeCodeLenses = lensChangeEmitter.event;

    constructor(findings: Map<string, Finding[]>) {
        this.findings = findings;
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const config = vscode.workspace.getConfiguration('latencylens');
        if (!config.get<boolean>('showCodeLens', true)) return [];

        const docFindings = this.findings.get(document.uri.toString());
        if (!docFindings) return [];

        const lenses: vscode.CodeLens[] = [];
        const seenLines = new Set<number>();

        for (const finding of docFindings) {
            for (const match of finding.matches) {
                const lineIdx = match.line - 1;
                if (lineIdx < 0 || lineIdx >= document.lineCount) continue;
                if (seenLines.has(lineIdx)) continue;
                seenLines.add(lineIdx);

                const range = new vscode.Range(lineIdx, 0, lineIdx, 0);

                // Benchmark lens
                lenses.push(new vscode.CodeLens(range, {
                    title: `⚡ Benchmark: ${finding.pattern_name}`,
                    command: 'latencylens.benchmarkPattern',
                    arguments: [finding.pattern_id],
                    tooltip: `Run real C++ benchmark for ${finding.pattern_name}\n${finding.short_desc}`,
                }));

                // Info lens
                lenses.push(new vscode.CodeLens(range, {
                    title: `${finding.severity === 'high' ? '🔴' : finding.severity === 'medium' ? '🟡' : '🔵'} ${finding.short_desc}`,
                    command: '',
                    tooltip: finding.explanation,
                }));
            }
        }

        return lenses;
    }
}
