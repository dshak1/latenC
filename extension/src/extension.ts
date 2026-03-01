/**
 * LatencyLens — VS Code Extension Entry Point
 * 
 * Activates on C/C++ files. Provides:
 * - Diagnostics (squiggly warnings on anti-patterns)
 * - CodeLens ("⚡ Benchmark" above patterns)
 * - Webview Dashboard (full interactive UI)
 * - Status bar item (pattern count)
 *
 * Architecture: Pure TypeScript — NO Python, NO Flask, NO server.
 * Analysis runs in-process via tree-sitter WASM (with regex fallback).
 * Benchmarks use local C++ compiler when available, reference data otherwise.
 */

import * as vscode from 'vscode';
import { Analyzer, Finding } from './analyzer';
import { LensProvider, lensChangeEmitter } from './codelens';
import { DashboardPanel } from './dashboard';
import { hasLocalBenchmarks, getCompilerInfo } from './benchmarkRunner';

let analyzer: Analyzer;
let diagnosticCollection: vscode.DiagnosticCollection;
let statusBarItem: vscode.StatusBarItem;
let lastFindings: Map<string, Finding[]> = new Map();

export async function activate(context: vscode.ExtensionContext) {
    console.log('LatencyLens activating...');

    // Initialize local analyzer (no server needed!)
    analyzer = new Analyzer(context.extensionPath);
    await analyzer.init();

    // Diagnostics collection
    diagnosticCollection = vscode.languages.createDiagnosticCollection('latencylens');
    context.subscriptions.push(diagnosticCollection);

    // Status bar
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'latencylens.openDashboard';
    statusBarItem.tooltip = 'LatencyLens — Click to open dashboard';
    context.subscriptions.push(statusBarItem);
    updateStatusBar(0);
    statusBarItem.show();

    // CodeLens provider
    const lensProvider = new LensProvider(lastFindings);
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            [{ language: 'cpp' }, { language: 'c' }],
            lensProvider
        )
    );

    // ── Commands ─────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('latencylens.openDashboard', () => {
            DashboardPanel.createOrShow(context, analyzer);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('latencylens.analyzeFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor');
                return;
            }
            await analyzeDocument(editor.document);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('latencylens.benchmarkPattern', async (patternId: string) => {
            await runBenchmarkInline(patternId);
        })
    );

    // ── Auto-analyze ─────────────────────────────────────

    const config = vscode.workspace.getConfiguration('latencylens');

    // Analyze on open (instant — no server wait needed)
    if (vscode.window.activeTextEditor) {
        const doc = vscode.window.activeTextEditor.document;
        if (doc.languageId === 'cpp' || doc.languageId === 'c') {
            setTimeout(() => analyzeDocument(doc), 500);
        }
    }

    // Analyze on save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (doc) => {
            if (config.get<boolean>('analyzeOnSave', true)) {
                if (doc.languageId === 'cpp' || doc.languageId === 'c') {
                    await analyzeDocument(doc);
                }
            }
        })
    );

    // Analyze on editor change
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(async (editor) => {
            if (editor && (editor.document.languageId === 'cpp' || editor.document.languageId === 'c')) {
                await analyzeDocument(editor.document);
            }
        })
    );

    // Clear diagnostics when file closes
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((doc) => {
            diagnosticCollection.delete(doc.uri);
            lastFindings.delete(doc.uri.toString());
        })
    );

    // Show activation message with mode info
    const compilerInfo = getCompilerInfo();
    const modeMsg = compilerInfo.compiler
        ? `⚡ LatencyLens active — analysis: ${analyzer.getMode()}, benchmarks: local (${compilerInfo.compiler})`
        : `⚡ LatencyLens active — analysis: ${analyzer.getMode()}, benchmarks: reference data`;
    console.log(modeMsg);
    vscode.window.showInformationMessage('⚡ LatencyLens active — open a C++ file to detect performance anti-patterns');
}

// ── Analysis ─────────────────────────────────────────────

async function analyzeDocument(document: vscode.TextDocument) {
    try {
        const code = document.getText();
        const findings = analyzer.analyze(code);

        // Store findings for CodeLens
        lastFindings.set(document.uri.toString(), findings);

        // Generate diagnostics
        const diagnostics: vscode.Diagnostic[] = [];

        for (const finding of findings) {
            for (const match of finding.matches) {
                const lineIdx = match.line - 1;
                if (lineIdx < 0 || lineIdx >= document.lineCount) continue;

                const line = document.lineAt(lineIdx);
                const range = new vscode.Range(
                    lineIdx, line.firstNonWhitespaceCharacterIndex,
                    lineIdx, line.text.length
                );

                const severity = finding.severity === 'high'
                    ? vscode.DiagnosticSeverity.Warning
                    : vscode.DiagnosticSeverity.Information;

                const diag = new vscode.Diagnostic(
                    range,
                    `⚡ ${finding.pattern_name}: ${finding.short_desc}`,
                    severity
                );
                diag.source = 'LatencyLens';
                diag.code = {
                    value: finding.pattern_id,
                    target: vscode.Uri.parse(`https://github.com/latencylens/patterns#${finding.pattern_id}`)
                };

                // Add detailed message
                const relatedInfo = new vscode.DiagnosticRelatedInformation(
                    new vscode.Location(document.uri, range),
                    finding.explanation.substring(0, 200) + '...'
                );
                diag.relatedInformation = [relatedInfo];

                diagnostics.push(diag);
            }
        }

        diagnosticCollection.set(document.uri, diagnostics);
        updateStatusBar(findings.length);

        // Trigger CodeLens refresh
        lensChangeEmitter.fire();

    } catch (e) {
        // Server might not be ready yet
        console.error('LatencyLens analysis error:', e);
    }
}

// ── Benchmark Inline ─────────────────────────────────────

async function runBenchmarkInline(patternId: string) {
    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `⚡ Compiling & benchmarking ${patternId}...`,
            cancellable: false,
        },
        async () => {
            return await analyzer.benchmark(patternId);
        }
    );

    if (result.error) {
        vscode.window.showErrorMessage(`Benchmark failed: ${result.error}`);
        return;
    }

    const before = formatNs(result.before_ns);
    const after = formatNs(result.after_ns);
    const sourceLabel = result.source === 'local' ? '🖥️ Live' : '📊 Reference';

    const action = await vscode.window.showInformationMessage(
        `⚡ ${result.pattern_name}: ${before} → ${after} (${result.speedup}× faster) [${sourceLabel}]`,
        'Open Dashboard',
        'Dismiss'
    );

    if (action === 'Open Dashboard') {
        vscode.commands.executeCommand('latencylens.openDashboard');
    }
}

// ── Helpers ──────────────────────────────────────────────

function updateStatusBar(count: number) {
    if (count === 0) {
        statusBarItem.text = '$(check) LatencyLens';
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = `$(warning) LatencyLens: ${count} pattern${count > 1 ? 's' : ''}`;
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
}

function formatNs(ns: number): string {
    if (ns >= 1e9) return (ns / 1e9).toFixed(2) + 's';
    if (ns >= 1e6) return (ns / 1e6).toFixed(2) + 'ms';
    if (ns >= 1e3) return (ns / 1e3).toFixed(1) + 'µs';
    return Math.round(ns) + 'ns';
}

export function deactivate() {
    // No server to stop — clean shutdown
}
