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
import { hasLocalBenchmarks, getCompilerInfo, BenchmarkPhase } from './benchmarkRunner';

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
    // Phase 1: Status bar progress
    const originalText = statusBarItem.text;
    const originalBg = statusBarItem.backgroundColor;
    statusBarItem.text = '$(sync~spin) Compiling benchmark...';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');

    try {
        const result = await analyzer.benchmark(patternId, undefined, (phase: BenchmarkPhase) => {
            switch (phase) {
                case 'compiling':
                    statusBarItem.text = '$(sync~spin) Compiling benchmark...';
                    break;
                case 'running':
                    statusBarItem.text = '$(sync~spin) Running benchmark...';
                    break;
                case 'done':
                    break;
            }
        });

        if (result.error) {
            statusBarItem.text = '$(error) Benchmark failed';
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            vscode.window.showErrorMessage(`Benchmark failed: ${result.error}`);
            setTimeout(() => { statusBarItem.text = originalText; statusBarItem.backgroundColor = originalBg; }, 3000);
            return;
        }

        // Phase 2: Show result in status bar
        const sourceIcon = result.source === 'local' ? '🖥️' : '📊';
        statusBarItem.text = `$(zap) ${result.speedup}× faster ${sourceIcon}`;
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');

        // Phase 3: Open chart panel
        BenchmarkResultPanel.show(result);

        // Reset status bar after 8 seconds
        setTimeout(() => { statusBarItem.text = originalText; statusBarItem.backgroundColor = originalBg; }, 8000);

    } catch (e: any) {
        statusBarItem.text = '$(error) Benchmark failed';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        vscode.window.showErrorMessage(`Benchmark error: ${e.message}`);
        setTimeout(() => { statusBarItem.text = originalText; statusBarItem.backgroundColor = originalBg; }, 3000);
    }
}

// ── Benchmark Result Panel ───────────────────────────────

import { BenchmarkResult } from './analyzer';
import { getPatternById, PATTERNS } from './patterns';

class BenchmarkResultPanel {
    private static panel: vscode.WebviewPanel | undefined;

    static show(result: BenchmarkResult) {
        // Find pattern by name (benchmark result has pattern_name, not id)
        const pattern = PATTERNS.find(p => p.name === result.pattern_name) || null;
        
        const beforeLabel = pattern?.before_label || 'Before';
        const afterLabel = pattern?.after_label || 'After';
        const patternName = result.pattern_name || 'Unknown';

        if (BenchmarkResultPanel.panel) {
            BenchmarkResultPanel.panel.webview.html = BenchmarkResultPanel.getHtml(result, patternName, beforeLabel, afterLabel);
            BenchmarkResultPanel.panel.reveal(vscode.ViewColumn.Beside, true);
            return;
        }

        BenchmarkResultPanel.panel = vscode.window.createWebviewPanel(
            'latencylens.benchResult',
            `⚡ ${patternName}`,
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            { enableScripts: true, retainContextWhenHidden: false }
        );

        BenchmarkResultPanel.panel.webview.html = BenchmarkResultPanel.getHtml(result, patternName, beforeLabel, afterLabel);

        BenchmarkResultPanel.panel.onDidDispose(() => {
            BenchmarkResultPanel.panel = undefined;
        });
    }

    private static getHtml(result: BenchmarkResult, name: string, beforeLabel: string, afterLabel: string): string {
        const beforeMs = (result.before_ns / 1e6).toFixed(2);
        const afterMs = (result.after_ns / 1e6).toFixed(2);
        const sourceLabel = result.source === 'local'
            ? '<span style="background:rgba(46,213,115,0.15);color:#2ed573;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600">🖥️ Live — your hardware</span>'
            : '<span style="background:rgba(255,165,2,0.15);color:#ffa502;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600">📊 Reference data</span>';
        const noteHtml = result.note ? `<p style="color:#555570;font-size:11px;font-style:italic;margin-top:6px">${result.note}</p>` : '';

        return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com;">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
:root {
    --bg: var(--vscode-editor-background, #0a0a0f);
    --bg2: var(--vscode-sideBar-background, #12121a);
    --card: var(--vscode-editorWidget-background, #1a1a25);
    --border: var(--vscode-widget-border, #2a2a3a);
    --text: var(--vscode-editor-foreground, #e8e8f0);
    --muted: var(--vscode-descriptionForeground, #8888a0);
    --red: #ff4757; --green: #2ed573; --gold: #ffa502;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); padding: 24px; }
.header { text-align: center; margin-bottom: 24px; }
.header h1 { font-family: 'JetBrains Mono', monospace; font-size: 18px; font-weight: 800; margin-bottom: 4px; }
.header .source { margin-top: 8px; }
.cards { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 24px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; text-align: center; }
.card.accent { background: rgba(255,165,2,0.08); border-color: var(--gold); }
.card-label { display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: var(--muted); margin-bottom: 8px; }
.card-value { display: block; font-family: 'JetBrains Mono', monospace; font-size: 32px; font-weight: 800; }
.card-value.red { color: var(--red); }
.card-value.green { color: var(--green); }
.card-value.gold { color: var(--gold); }
.card-unit { font-size: 14px; font-weight: 600; opacity: 0.7; }
.chart-wrap { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; height: 280px; }
</style>
</head>
<body>
<div class="header">
    <h1>⚡ ${name}</h1>
    <div class="source">${sourceLabel}</div>
    ${noteHtml}
</div>
<div class="cards">
    <div class="card">
        <span class="card-label">${beforeLabel}</span>
        <span class="card-value red">${beforeMs}<span class="card-unit">ms</span></span>
    </div>
    <div class="card accent">
        <span class="card-label">Speedup</span>
        <span class="card-value gold">${result.speedup}×</span>
    </div>
    <div class="card">
        <span class="card-label">${afterLabel}</span>
        <span class="card-value green">${afterMs}<span class="card-unit">ms</span></span>
    </div>
</div>
<div class="chart-wrap"><canvas id="chart"></canvas></div>
<script>
document.addEventListener('DOMContentLoaded', () => {
    const ctx = document.getElementById('chart').getContext('2d');
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [${JSON.stringify(beforeLabel)}, ${JSON.stringify(afterLabel)}],
            datasets: [{
                data: [${result.before_ns}, ${result.after_ns}],
                backgroundColor: ['rgba(255,71,87,0.7)', 'rgba(46,213,115,0.7)'],
                borderColor: ['rgba(255,71,87,1)', 'rgba(46,213,115,1)'],
                borderWidth: 2, borderRadius: 8, barPercentage: 0.6
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            animation: { duration: 800, easing: 'easeOutQuart' },
            plugins: {
                legend: { display: false },
                title: {
                    display: true,
                    text: '${result.speedup}× faster — N=${(result.data_size || 100000).toLocaleString()}',
                    color: '#e8e8f0', font: { family: 'JetBrains Mono', size: 13, weight: '700' }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(42,42,58,0.5)' },
                    ticks: { color: '#8888a0', font: { family: 'JetBrains Mono', size: 10 },
                        callback: v => { if(v>=1e9) return (v/1e9).toFixed(1)+'s'; if(v>=1e6) return (v/1e6).toFixed(1)+'ms'; if(v>=1e3) return (v/1e3).toFixed(0)+'µs'; return v+'ns'; }
                    }
                },
                x: { grid: { display: false }, ticks: { color: '#e8e8f0', font: { family: 'JetBrains Mono', size: 12, weight: '700' } } }
            }
        }
    });
});
</script>
</body></html>`;
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
