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
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { Analyzer, Finding } from './analyzer';
import { LensProvider, lensChangeEmitter } from './codelens';
import { DashboardPanel } from './dashboard';
import { hasLocalBenchmarks, getCompilerInfo, BenchmarkPhase } from './benchmarkRunner';

let analyzer: Analyzer;
let diagnosticCollection: vscode.DiagnosticCollection;
let statusBarItem: vscode.StatusBarItem;
let lastFindings: Map<string, Finding[]> = new Map();
let extensionEnabled = true;

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
    statusBarItem.tooltip = 'LatencyLens - Click to open dashboard';
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

    // Toggle on/off
    context.subscriptions.push(
        vscode.commands.registerCommand('latencylens.toggle', () => {
            extensionEnabled = !extensionEnabled;
            if (!extensionEnabled) {
                diagnosticCollection.clear();
                lastFindings.clear();
                lensChangeEmitter.fire();
                updateStatusBar(0, false);
                vscode.window.showInformationMessage('LatencyLens disabled');
            } else {
                updateStatusBar(0, true);
                vscode.window.showInformationMessage('LatencyLens enabled');
                const editor = vscode.window.activeTextEditor;
                if (editor && (editor.document.languageId === 'cpp' || editor.document.languageId === 'c')) {
                    analyzeDocument(editor.document);
                }
            }
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
        ? `LatencyLens active - analysis: ${analyzer.getMode()}, benchmarks: local (${compilerInfo.compiler})`
        : `LatencyLens active - analysis: ${analyzer.getMode()}, benchmarks: reference data`;
    console.log(modeMsg);
    vscode.window.showInformationMessage('LatencyLens active - open a C++ file to detect performance anti-patterns');
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

        // Play error sound if high-severity patterns found
        if (diagnostics.some(d => d.severity === vscode.DiagnosticSeverity.Warning)) {
            playErrorSound();
        }

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
            playErrorSound();
            statusBarItem.text = '$(error) Benchmark failed';
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            vscode.window.showErrorMessage(`Benchmark failed: ${result.error}`);
            setTimeout(() => { statusBarItem.text = originalText; statusBarItem.backgroundColor = originalBg; }, 3000);
            return;
        }

        // Phase 2: Show result in status bar
        const sourceLabel = result.source === 'local' ? 'live' : 'ref';
        statusBarItem.text = `$(zap) ${result.speedup}x faster (${sourceLabel})`;
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');

        // Phase 3: Open chart panel
        BenchmarkResultPanel.show(result);

        // Reset status bar after 8 seconds
        setTimeout(() => { statusBarItem.text = originalText; statusBarItem.backgroundColor = originalBg; }, 8000);

    } catch (e: any) {
        playErrorSound();
        statusBarItem.text = '$(error) Benchmark failed';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        vscode.window.showErrorMessage(`Benchmark error: ${e.message}`);
        setTimeout(() => { statusBarItem.text = originalText; statusBarItem.backgroundColor = originalBg; }, 3000);
    }
}

// ── Benchmark Result Panel ───────────────────────────────

import { BenchmarkResult } from './analyzer';
import { getPatternById, PATTERNS, Pattern } from './patterns';

class BenchmarkResultPanel {
    private static panel: vscode.WebviewPanel | undefined;

    static show(result: BenchmarkResult) {
        const pattern = PATTERNS.find(p => p.name === result.pattern_name) || null;
        const html = BenchmarkResultPanel.getHtml(result, pattern);

        if (BenchmarkResultPanel.panel) {
            BenchmarkResultPanel.panel.webview.html = html;
            BenchmarkResultPanel.panel.reveal(vscode.ViewColumn.Beside, true);
            return;
        }

        BenchmarkResultPanel.panel = vscode.window.createWebviewPanel(
            'latencylens.benchResult',
            `${result.pattern_name || 'Benchmark'}`,
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            { enableScripts: true, retainContextWhenHidden: false }
        );

        BenchmarkResultPanel.panel.webview.html = html;
        BenchmarkResultPanel.panel.onDidDispose(() => { BenchmarkResultPanel.panel = undefined; });
    }

    private static esc(s: string): string {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    private static getHtml(r: BenchmarkResult, p: Pattern | null): string {
        const beforeMs = (r.before_ns / 1e6).toFixed(2);
        const afterMs = (r.after_ns / 1e6).toFixed(2);
        const pct = Math.round((1 - r.after_ns / r.before_ns) * 100);
        const barW = Math.max(5, Math.round((r.after_ns / r.before_ns) * 100));
        const name = r.pattern_name || 'Benchmark';
        const beforeLabel = p?.before_label || 'Before';
        const afterLabel = p?.after_label || 'After';
        const sourceBadge = r.source === 'local'
            ? '<span class="badge badge-live">LIVE</span>'
            : '<span class="badge badge-ref">REF</span>';
        const note = r.note ? `<span class="note">${BenchmarkResultPanel.esc(r.note)}</span>` : '';

        const beforeCode = p ? BenchmarkResultPanel.esc(p.before_snippet) : '';
        const afterCode = p ? BenchmarkResultPanel.esc(p.after_snippet) : '';
        const fixHint = p?.fix_hint ? `<section class="section"><h2>How to Fix</h2><p class="fix-text">${BenchmarkResultPanel.esc(p.fix_hint)}</p></section>` : '';
        const speedupCtx = p?.speedup_context ? `<section class="section"><h2>What This Means</h2><p class="context-text">${BenchmarkResultPanel.esc(p.speedup_context)}</p></section>` : '';
        const refs = p?.references?.length
            ? `<section class="section"><h2>C++ Reference</h2><ul class="link-list">${p.references.map(l => `<li><a href="${l.url}">${BenchmarkResultPanel.esc(l.title)}</a></li>`).join('')}</ul></section>`
            : '';
        const reading = p?.further_reading?.length
            ? `<section class="section"><h2>Further Reading</h2><ul class="link-list">${p.further_reading.map(l => `<li><a href="${l.url}">${BenchmarkResultPanel.esc(l.title)}</a></li>`).join('')}</ul></section>`
            : '';
        const explanation = p?.explanation
            ? `<p class="explanation">${BenchmarkResultPanel.esc(p.explanation)}</p>`
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
    <h1>${BenchmarkResultPanel.esc(name)} ${sourceBadge}</h1>
    ${p ? `<div class="category">${BenchmarkResultPanel.esc(p.category)}</div>` : ''}
</div>

<div class="timing">
    <div class="timing-row">
        <span class="timing-label">${BenchmarkResultPanel.esc(beforeLabel)}</span>
        <div class="timing-bar"><div class="timing-bar-fill slow" style="width:100%"></div></div>
        <span class="timing-val slow">${beforeMs} ms</span>
    </div>
    <div class="timing-row">
        <span class="timing-label">${BenchmarkResultPanel.esc(afterLabel)}</span>
        <div class="timing-bar"><div class="timing-bar-fill fast" style="width:${barW}%"></div></div>
        <span class="timing-val fast">${afterMs} ms</span>
    </div>
    <div class="speedup-line">
        <span class="speedup-num">${r.speedup}× faster</span>
        <span class="speedup-detail">${pct}% less time &middot; N=${(r.data_size || 0).toLocaleString()}</span>
    </div>
    ${note}
</div>

${explanation}

${(beforeCode || afterCode) ? `
<div class="diff">
    <div class="diff-col">
        <div class="diff-header before"><span class="dot"></span> ${BenchmarkResultPanel.esc(beforeLabel)}</div>
        <pre class="code">${beforeCode}</pre>
    </div>
    <div class="diff-col">
        <div class="diff-header after"><span class="dot"></span> ${BenchmarkResultPanel.esc(afterLabel)}</div>
        <pre class="code">${afterCode}</pre>
    </div>
</div>` : ''}

${speedupCtx}
${fixHint}
${refs}
${reading}

<div class="footer">LatencyLens - Speedup (up to) - actual results depend on data, compiler, and hardware</div>
</body></html>`;
    }
}

// ── Helpers ──────────────────────────────────────────────

function updateStatusBar(count: number, enabled: boolean = true) {
    if (!enabled) {
        statusBarItem.text = '$(circle-slash) LatencyLens (off)';
        statusBarItem.backgroundColor = undefined;
        return;
    }
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

// ── Error Sound ──────────────────────────────────────────

let errorSoundPath: string | undefined;

/**
 * Generate a short descending "fahhh" tone as a WAV file and play it.
 * Sounds like a quick failure buzzer: 440Hz dropping to 180Hz over 0.35s.
 */
function playErrorSound(): void {
    try {
        if (!errorSoundPath || !fs.existsSync(errorSoundPath)) {
            errorSoundPath = path.join(os.tmpdir(), 'latencylens-error.wav');
            const sampleRate = 22050;
            const duration = 0.35;
            const numSamples = Math.floor(sampleRate * duration);
            const buffer = Buffer.alloc(44 + numSamples * 2);

            // WAV header
            buffer.write('RIFF', 0);
            buffer.writeUInt32LE(36 + numSamples * 2, 4);
            buffer.write('WAVE', 8);
            buffer.write('fmt ', 12);
            buffer.writeUInt32LE(16, 16);      // chunk size
            buffer.writeUInt16LE(1, 20);       // PCM
            buffer.writeUInt16LE(1, 22);       // mono
            buffer.writeUInt32LE(sampleRate, 24);
            buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
            buffer.writeUInt16LE(2, 32);       // block align
            buffer.writeUInt16LE(16, 34);      // bits per sample
            buffer.write('data', 36);
            buffer.writeUInt32LE(numSamples * 2, 40);

            // Descending tone: 440Hz -> 180Hz with fade out
            for (let i = 0; i < numSamples; i++) {
                const t = i / sampleRate;
                const progress = i / numSamples;
                const freq = 440 - (440 - 180) * progress;
                const envelope = Math.pow(1 - progress, 1.5);
                const sample = Math.sin(2 * Math.PI * freq * t) * envelope * 0.6;
                buffer.writeInt16LE(Math.floor(sample * 32767), 44 + i * 2);
            }

            fs.writeFileSync(errorSoundPath, buffer);
        }

        // Play with OS audio command (fire and forget)
        const platform = process.platform;
        if (platform === 'darwin') {
            execFile('afplay', [errorSoundPath], () => {});
        } else if (platform === 'linux') {
            execFile('aplay', ['-q', errorSoundPath], () => {});
        } else if (platform === 'win32') {
            execFile('powershell', ['-c', `(New-Object Media.SoundPlayer '${errorSoundPath}').PlaySync()`], () => {});
        }
    } catch {
        // Audio is non-critical, fail silently
    }
}

export function deactivate() {
    // Clean up temp sound file
    if (errorSoundPath && fs.existsSync(errorSoundPath)) {
        try { fs.unlinkSync(errorSoundPath); } catch {}
    }
}
