/**
 * LatenC — VS Code Extension Entry Point
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
import { Analyzer, BenchmarkResult, Finding } from './analyzer';
import { LensProvider, lensChangeEmitter } from './codelens';
import { DashboardPanel } from './dashboard';
import { getCompilerInfo, BenchmarkPhase } from './benchmarkRunner';
import { getPatternById, Pattern } from './patterns';

let analyzer: Analyzer;
let diagnosticCollection: vscode.DiagnosticCollection;
let statusBarItem: vscode.StatusBarItem;
let lastFindings: Map<string, Finding[]> = new Map();
let extensionEnabled = true;
const DYNAMIC_ANALYSIS_SIZES = [1000, 10_000, 100_000, 1_000_000];

export async function activate(context: vscode.ExtensionContext) {
    console.log('LatenC activating...');

    // Initialize local analyzer (no server needed!)
    analyzer = new Analyzer(context.extensionPath);
    await analyzer.init();

    // Diagnostics collection
    diagnosticCollection = vscode.languages.createDiagnosticCollection('LatenC');
    context.subscriptions.push(diagnosticCollection);

    // Status bar
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'LatenC.openDashboard';
    statusBarItem.tooltip = 'LatenC - Click to open dashboard';
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
        vscode.commands.registerCommand('LatenC.openDashboard', () => {
            DashboardPanel.createOrShow(context, analyzer);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('LatenC.analyzeFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor');
                return;
            }
            await analyzeDocument(editor.document);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('LatenC.analyzePattern', async (patternId: string) => {
            await runBenchmarkInline(patternId);
        })
    );

    // Toggle on/off
    context.subscriptions.push(
        vscode.commands.registerCommand('LatenC.toggle', () => {
            extensionEnabled = !extensionEnabled;
            if (!extensionEnabled) {
                diagnosticCollection.clear();
                lastFindings.clear();
                lensChangeEmitter.fire();
                updateStatusBar(0, false);
                vscode.window.showInformationMessage('LatenC disabled');
            } else {
                updateStatusBar(0, true);
                vscode.window.showInformationMessage('LatenC enabled');
                const editor = vscode.window.activeTextEditor;
                if (editor && (editor.document.languageId === 'cpp' || editor.document.languageId === 'c')) {
                    analyzeDocument(editor.document);
                }
            }
        })
    );

    // ── Auto-analyze ─────────────────────────────────────

    const config = vscode.workspace.getConfiguration('LatenC');

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
        ? `LatenC active - analysis: ${analyzer.getMode()}, benchmarks: local (${compilerInfo.compiler})`
        : `LatenC active - analysis: ${analyzer.getMode()}, benchmarks: reference data`;
    console.log(modeMsg);
    vscode.window.showInformationMessage('LatenC active - open a C++ file to detect performance anti-patterns');
}

// ── Analysis ─────────────────────────────────────────────

async function analyzeDocument(document: vscode.TextDocument) {
    if (!extensionEnabled) return;
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
                    `${finding.pattern_name}: ${finding.short_desc}`,
                    severity
                );
                diag.source = 'LatenC';
                diag.code = {
                    value: finding.pattern_id,
                    target: vscode.Uri.parse(`https://github.com/LatenC/patterns#${finding.pattern_id}`)
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
        console.error('LatenC analysis error:', e);
    }
}

// ── Pattern Analysis ────────────────────────────────────

interface PatternAnalysisReport {
    pattern: Pattern | null;
    primaryResult: BenchmarkResult;
    scalingResults: BenchmarkResult[];
    analysisMode: string;
}

async function runBenchmarkInline(patternId: string) {
    // Phase 1: Status bar progress
    const originalText = statusBarItem.text;
    const originalBg = statusBarItem.backgroundColor;
    statusBarItem.text = '$(sync~spin) Running dynamic analysis...';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');

    try {
        const primaryResult = await analyzer.benchmark(patternId, undefined, (phase: BenchmarkPhase) => {
            switch (phase) {
                case 'compiling':
                    statusBarItem.text = '$(sync~spin) Compiling dynamic analysis...';
                    break;
                case 'running':
                    statusBarItem.text = '$(sync~spin) Running dynamic analysis...';
                    break;
                case 'done':
                    break;
            }
        });

        if (primaryResult.error) {
            statusBarItem.text = '$(error) Benchmark failed';
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            vscode.window.showErrorMessage(`Analysis failed: ${primaryResult.error}`);
            setTimeout(() => { statusBarItem.text = originalText; statusBarItem.backgroundColor = originalBg; }, 3000);
            return;
        }

        statusBarItem.text = '$(sync~spin) Building scaling profile...';
        const scalingResults = await analyzer.scalingBenchmark(patternId, DYNAMIC_ANALYSIS_SIZES);

        // Phase 2: Show result in status bar
        const sourceLabel = primaryResult.source === 'local' ? 'live' : 'ref';
        statusBarItem.text = `$(graph) ${primaryResult.speedup}x faster (${sourceLabel})`;
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');

        // Phase 3: Open the full static + dynamic analysis report
        AnalysisReportPanel.show({
            pattern: getPatternById(patternId) || null,
            primaryResult,
            scalingResults,
            analysisMode: analyzer.getMode(),
        });

        // Reset status bar after 8 seconds
        setTimeout(() => { statusBarItem.text = originalText; statusBarItem.backgroundColor = originalBg; }, 8000);

    } catch (e: any) {
        statusBarItem.text = '$(error) Analysis failed';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        vscode.window.showErrorMessage(`Analysis error: ${e.message}`);
        setTimeout(() => { statusBarItem.text = originalText; statusBarItem.backgroundColor = originalBg; }, 3000);
    }
}

// ── Analysis Report Panel ────────────────────────────────

class AnalysisReportPanel {
    private static panel: vscode.WebviewPanel | undefined;

    static show(report: PatternAnalysisReport) {
        const html = AnalysisReportPanel.getHtml(report);

        if (AnalysisReportPanel.panel) {
            AnalysisReportPanel.panel.webview.html = html;
            AnalysisReportPanel.panel.reveal(vscode.ViewColumn.Beside, true);
            return;
        }

        AnalysisReportPanel.panel = vscode.window.createWebviewPanel(
            'LatenC.analysisReport',
            `${report.primaryResult.pattern_name || 'Analysis'} Report`,
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            { enableScripts: true, retainContextWhenHidden: false }
        );

        AnalysisReportPanel.panel.webview.html = html;
        AnalysisReportPanel.panel.onDidDispose(() => { AnalysisReportPanel.panel = undefined; });
    }

    private static esc(s: string): string {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    private static getHtml(report: PatternAnalysisReport): string {
        const r = report.primaryResult;
        const p = report.pattern;
        const validScaling = report.scalingResults.filter(result => !result.error);
        const speedups = validScaling.map(result => result.speedup).filter(speedup => Number.isFinite(speedup) && speedup > 0);
        const beforeMs = (r.before_ns / 1e6).toFixed(2);
        const afterMs = (r.after_ns / 1e6).toFixed(2);
        const pct = r.before_ns > 0 ? Math.round((1 - r.after_ns / r.before_ns) * 100) : 0;
        const barW = r.before_ns > 0 ? Math.max(5, Math.round((r.after_ns / r.before_ns) * 100)) : 100;
        const name = r.pattern_name || 'Pattern Analysis';
        const beforeLabel = p?.before_label || 'Before';
        const afterLabel = p?.after_label || 'After';
        const sourceBadge = r.source === 'local'
            ? '<span class="badge badge-live">LIVE</span>'
            : '<span class="badge badge-ref">REF</span>';
        const confidenceNote = (r.sample_count && r.variability_pct !== undefined && r.confidence)
            ? `Samples: ${r.sample_count}, variability: ${r.variability_pct.toFixed(1)}%, confidence: ${r.confidence}`
            : '';
        const mergedNote = [r.note, confidenceNote].filter(Boolean).join(' · ');
        const note = mergedNote ? `<span class="note">${AnalysisReportPanel.esc(mergedNote)}</span>` : '';
        const staticMeta = [
            `Static engine: ${report.analysisMode}`,
            p ? `Severity: ${p.severity}` : '',
            p ? `Category: ${p.category}` : '',
        ].filter(Boolean);
        const dynamicMethod = r.source === 'local'
            ? 'Dynamic analysis compiled and ran the before/after benchmark locally on this machine, then built a small scaling profile across increasing input sizes.'
            : 'Dynamic analysis is using curated reference measurements because no local compiler was available. The static analysis remains local.';
        const scalingSummary = speedups.length > 0
            ? [
                describeSpeedupTrend(speedups),
                describeSpeedupConsistency(speedups),
            ]
            : ['No scaling points were available for this pattern.'];
        const scalingRows = validScaling.length > 0
            ? validScaling.map(result => `
                <tr>
                    <td>${result.data_size.toLocaleString()}</td>
                    <td>${AnalysisReportPanel.esc(formatNs(result.before_ns))}</td>
                    <td>${AnalysisReportPanel.esc(formatNs(result.after_ns))}</td>
                    <td>${result.speedup}×</td>
                    <td>${AnalysisReportPanel.esc(result.source)}</td>
                </tr>
            `).join('')
            : '<tr><td colspan="5">No dynamic scaling data available.</td></tr>';

        const beforeCode = p ? AnalysisReportPanel.esc(p.before_snippet) : '';
        const afterCode = p ? AnalysisReportPanel.esc(p.after_snippet) : '';
        const fixHint = p?.fix_hint ? `<section class="section"><h2>How to Fix</h2><p class="fix-text">${AnalysisReportPanel.esc(p.fix_hint)}</p></section>` : '';
        const speedupCtx = p?.speedup_context ? `<section class="section"><h2>Why It Matters</h2><p class="context-text">${AnalysisReportPanel.esc(p.speedup_context)}</p></section>` : '';
        const refs = p?.references?.length
            ? `<section class="section"><h2>C++ Reference</h2><ul class="link-list">${p.references.map(l => `<li><a href="${l.url}">${AnalysisReportPanel.esc(l.title)}</a></li>`).join('')}</ul></section>`
            : '';
        const reading = p?.further_reading?.length
            ? `<section class="section"><h2>Further Reading</h2><ul class="link-list">${p.further_reading.map(l => `<li><a href="${l.url}">${AnalysisReportPanel.esc(l.title)}</a></li>`).join('')}</ul></section>`
            : '';
        const explanation = p?.explanation
            ? `<p class="explanation">${AnalysisReportPanel.esc(p.explanation)}</p>`
            : '';

        return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
:root {
    --bg: var(--vscode-editor-background, #1e1e1e);
    --card: var(--vscode-editorWidget-background, #252526);
    --border: var(--vscode-widget-border, #3c3c3c);
    --text: var(--vscode-editor-foreground, #cccccc);
    --muted: var(--vscode-descriptionForeground, #808080);
    --link: var(--vscode-textLink-foreground, #3794ff);
    --red: #e06c75;
    --green: #98c379;
    --gold: #e5c07b;
    --mono: 'SF Mono', 'Cascadia Code', 'Fira Code', Menlo, Monaco, 'Courier New', monospace;
    --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: var(--sans); background: var(--bg); color: var(--text); padding: 20px; font-size: 13px; line-height: 1.5; }

/* ── Header ── */
.header { margin-bottom: 20px; }
.header h1 { font-family: var(--mono); font-size: 15px; font-weight: 600; letter-spacing: -0.3px; display: flex; align-items: center; gap: 8px; }
.badge { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 3px; letter-spacing: 0.5px; vertical-align: middle; }
.badge-live { background: rgba(152,195,121,0.15); color: var(--green); }
.badge-ref { background: rgba(229,192,123,0.15); color: var(--gold); }
.category { font-size: 11px; color: var(--muted); margin-top: 2px; }
.meta-row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.meta-chip { background: var(--card); border: 1px solid var(--border); color: var(--text); border-radius: 999px; padding: 4px 10px; font-size: 11px; font-family: var(--mono); }

/* ── Timing bar ── */
.timing { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 16px; margin-bottom: 16px; }
.timing-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.timing-row:last-child { margin-bottom: 0; }
.timing-label { font-family: var(--mono); font-size: 11px; color: var(--muted); width: 64px; flex-shrink: 0; text-align: right; }
.timing-bar { flex: 1; height: 24px; border-radius: 4px; position: relative; }
.timing-bar-fill { height: 100%; border-radius: 4px; transition: width 0.6s ease; }
.timing-bar-fill.slow { background: var(--red); }
.timing-bar-fill.fast { background: var(--green); }
.timing-val { font-family: var(--mono); font-size: 12px; font-weight: 600; width: 72px; flex-shrink: 0; }
.timing-val.slow { color: var(--red); }
.timing-val.fast { color: var(--green); }

.speedup-line { display: flex; justify-content: space-between; align-items: baseline; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); }
.speedup-num { font-family: var(--mono); font-size: 20px; font-weight: 700; color: var(--gold); }
.speedup-detail { font-size: 11px; color: var(--muted); }
.note { font-size: 11px; color: var(--muted); font-style: italic; }

/* ── Code diff ── */
.diff { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
.diff-col { background: var(--card); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.diff-header { font-family: var(--mono); font-size: 11px; font-weight: 600; padding: 6px 12px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 6px; }
.diff-header.before { color: var(--red); }
.diff-header.after { color: var(--green); }
.diff-header .dot { width: 6px; height: 6px; border-radius: 50%; }
.diff-header.before .dot { background: var(--red); }
.diff-header.after .dot { background: var(--green); }
pre.code { font-family: var(--mono); font-size: 11.5px; line-height: 1.6; padding: 10px 12px; overflow-x: auto; white-space: pre; color: var(--text); tab-size: 4; }
pre.code .comment { color: var(--muted); }

/* ── Sections ── */
.explanation { font-size: 12.5px; color: var(--text); line-height: 1.6; margin-bottom: 16px; opacity: 0.85; }
.section { margin-bottom: 16px; }
.section h2 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); margin-bottom: 8px; }
.fix-text { font-size: 12.5px; line-height: 1.6; padding: 10px 12px; background: var(--card); border: 1px solid var(--border); border-radius: 6px; border-left: 3px solid var(--green); }
.context-text { font-size: 12.5px; line-height: 1.6; padding: 10px 12px; background: var(--card); border: 1px solid var(--border); border-radius: 6px; border-left: 3px solid var(--gold); color: var(--text); opacity: 0.9; }
.method-text { font-size: 12.5px; line-height: 1.6; padding: 10px 12px; background: var(--card); border: 1px solid var(--border); border-radius: 6px; border-left: 3px solid var(--link); }
.analysis-list { margin-left: 18px; color: var(--text); }
.analysis-list li { margin-bottom: 6px; }
.scaling-table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.scaling-table th, .scaling-table td { padding: 10px 12px; border-bottom: 1px solid var(--border); text-align: left; font-family: var(--mono); font-size: 11px; }
.scaling-table th { color: var(--muted); text-transform: uppercase; letter-spacing: 0.6px; }
.scaling-table tr:last-child td { border-bottom: none; }
.link-list { list-style: none; }
.link-list li { margin-bottom: 4px; }
.link-list a { color: var(--link); text-decoration: none; font-size: 12px; }
.link-list a:hover { text-decoration: underline; }
.link-list a::before { content: '→ '; color: var(--muted); }

/* ── Footer ── */
.footer { margin-top: 20px; padding-top: 12px; border-top: 1px solid var(--border); font-size: 10px; color: var(--muted); text-align: center; }
</style>
</head>
<body>
<div class="header">
    <h1>${AnalysisReportPanel.esc(name)} ${sourceBadge}</h1>
    ${p ? `<div class="category">${AnalysisReportPanel.esc(p.category)}</div>` : ''}
    <div class="meta-row">
        ${staticMeta.map(item => `<span class="meta-chip">${AnalysisReportPanel.esc(item)}</span>`).join('')}
    </div>
</div>

<section class="section">
    <h2>Static Analysis</h2>
    ${explanation}
</section>

<div class="timing">
    <div class="timing-row">
        <span class="timing-label">${AnalysisReportPanel.esc(beforeLabel)}</span>
        <div class="timing-bar"><div class="timing-bar-fill slow" style="width:100%"></div></div>
        <span class="timing-val slow">${beforeMs} ms</span>
    </div>
    <div class="timing-row">
        <span class="timing-label">${AnalysisReportPanel.esc(afterLabel)}</span>
        <div class="timing-bar"><div class="timing-bar-fill fast" style="width:${barW}%"></div></div>
        <span class="timing-val fast">${afterMs} ms</span>
    </div>
    <div class="speedup-line">
        <span class="speedup-num">${r.speedup}× faster</span>
        <span class="speedup-detail">${pct}% less time &middot; N=${(r.data_size || 0).toLocaleString()}</span>
    </div>
    ${note}
</div>

<section class="section">
    <h2>Dynamic Analysis</h2>
    <p class="method-text">${AnalysisReportPanel.esc(dynamicMethod)}</p>
</section>

${(beforeCode || afterCode) ? `
<div class="diff">
    <div class="diff-col">
        <div class="diff-header before"><span class="dot"></span> ${AnalysisReportPanel.esc(beforeLabel)}</div>
        <pre class="code">${beforeCode}</pre>
    </div>
    <div class="diff-col">
        <div class="diff-header after"><span class="dot"></span> ${AnalysisReportPanel.esc(afterLabel)}</div>
        <pre class="code">${afterCode}</pre>
    </div>
</div>` : ''}

<section class="section">
    <h2>Dynamic Takeaways</h2>
    <ul class="analysis-list">
        ${scalingSummary.map(item => `<li>${AnalysisReportPanel.esc(item)}</li>`).join('')}
    </ul>
</section>

<section class="section">
    <h2>Scaling Profile</h2>
    <table class="scaling-table">
        <thead>
            <tr>
                <th>Size</th>
                <th>${AnalysisReportPanel.esc(beforeLabel)}</th>
                <th>${AnalysisReportPanel.esc(afterLabel)}</th>
                <th>Speedup</th>
                <th>Source</th>
            </tr>
        </thead>
        <tbody>
            ${scalingRows}
        </tbody>
    </table>
</section>

${speedupCtx}
${fixHint}
${refs}
${reading}

<div class="footer">LatenC combines static analysis to flag the pattern and dynamic analysis to quantify its runtime cost.</div>
</body></html>`;
    }
}

// ── Helpers ──────────────────────────────────────────────

function updateStatusBar(count: number, enabled: boolean = true) {
    if (!enabled) {
        statusBarItem.text = '$(circle-slash) LatenC (off)';
        statusBarItem.backgroundColor = undefined;
        return;
    }
    if (count === 0) {
        statusBarItem.text = '$(check) LatenC';
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = `$(warning) LatenC: ${count} pattern${count > 1 ? 's' : ''}`;
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
}

function formatNs(ns: number): string {
    if (ns >= 1e9) return (ns / 1e9).toFixed(2) + 's';
    if (ns >= 1e6) return (ns / 1e6).toFixed(2) + 'ms';
    if (ns >= 1e3) return (ns / 1e3).toFixed(1) + 'µs';
    return Math.round(ns) + 'ns';
}

function describeSpeedupTrend(speedups: number[]): string {
    if (speedups.length < 2) {
        return 'Dynamic profile has one usable data point, so growth trends are limited.';
    }

    const first = speedups[0];
    const last = speedups[speedups.length - 1];
    const delta = last - first;

    if (Math.abs(delta) < 0.25) {
        return `Speedup stays fairly stable across tested sizes (${first.toFixed(2)}× to ${last.toFixed(2)}×).`;
    }
    if (delta > 0) {
        return `Fix impact grows with larger inputs (${first.toFixed(2)}× to ${last.toFixed(2)}×), which suggests the underlying cost compounds under load.`;
    }
    return `Fix impact is strongest at smaller inputs (${first.toFixed(2)}× to ${last.toFixed(2)}×), so the pattern matters most in shorter hot paths.`;
}

function describeSpeedupConsistency(speedups: number[]): string {
    if (speedups.length === 0) {
        return 'No reliable speedup measurements were available.';
    }

    const min = Math.min(...speedups);
    const max = Math.max(...speedups);
    const spread = max - min;

    if (spread <= 0.5) {
        return `Dynamic evidence is consistent across tested sizes (spread ${spread.toFixed(2)}×).`;
    }
    if (spread <= 1.5) {
        return `Dynamic evidence varies moderately across tested sizes (spread ${spread.toFixed(2)}×), so data size meaningfully changes the payoff.`;
    }
    return `Dynamic evidence varies substantially across tested sizes (spread ${spread.toFixed(2)}×), which is a signal to profile this pattern against production-like workloads.`;
}

export function deactivate() {}
