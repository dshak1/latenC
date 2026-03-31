/**
 * LatencyLens — Webview Dashboard Panel
 * 
 * Embeds the full interactive dashboard inside VS Code as a Webview.
 * Communicates via postMessage — NO HTTP, NO server dependency.
 * All data comes from the local Analyzer + BenchmarkRunner.
 */

import * as vscode from 'vscode';
import { Analyzer } from './analyzer';
import { PATTERNS, getPatternById, getPatternSummaries } from './patterns';
import { getCompilerInfo, hasLocalBenchmarks } from './benchmarkRunner';

export class DashboardPanel {
    public static currentPanel: DashboardPanel | undefined;
    private static readonly viewType = 'latencylens.dashboard';

    private readonly panel: vscode.WebviewPanel;
    private readonly analyzer: Analyzer;
    private disposed = false;

    public static createOrShow(context: vscode.ExtensionContext, analyzer: Analyzer) {
        const column = vscode.ViewColumn.Beside;

        if (DashboardPanel.currentPanel) {
            DashboardPanel.currentPanel.panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            DashboardPanel.viewType,
            'LatencyLens',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [],
            }
        );

        DashboardPanel.currentPanel = new DashboardPanel(panel, analyzer);
    }

    private constructor(panel: vscode.WebviewPanel, analyzer: Analyzer) {
        this.panel = panel;
        this.analyzer = analyzer;

        this.panel.webview.html = this.getHtml();

        this.panel.onDidDispose(() => {
            this.disposed = true;
            DashboardPanel.currentPanel = undefined;
        });

        // Handle messages from webview — replaces HTTP API calls
        this.panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.command) {
                case 'getPatterns':
                    this.panel.webview.postMessage({
                        command: 'patterns',
                        data: getPatternSummaries(),
                    });
                    break;
                case 'getPattern':
                    const p = getPatternById(msg.id);
                    if (p) {
                        this.panel.webview.postMessage({
                            command: 'patternDetail',
                            data: {
                                id: p.id, name: p.name, category: p.category,
                                short_desc: p.short_desc, explanation: p.explanation,
                                before_label: p.before_label, after_label: p.after_label,
                                before_snippet: p.before_snippet, after_snippet: p.after_snippet,
                            },
                        });
                    }
                    break;
                case 'runBenchmark':
                    try {
                        const result = await this.analyzer.benchmark(msg.patternId, msg.dataSize);
                        this.panel.webview.postMessage({ command: 'benchmarkResult', data: result });
                    } catch (e: any) {
                        this.panel.webview.postMessage({ command: 'benchmarkResult', data: { error: e.message } });
                    }
                    break;
                case 'runScaling':
                    try {
                        const results = await this.analyzer.scalingBenchmark(msg.patternId, msg.sizes);
                        this.panel.webview.postMessage({ command: 'scalingResult', data: results });
                    } catch (e: any) {
                        this.panel.webview.postMessage({ command: 'scalingResult', data: { error: e.message } });
                    }
                    break;
                case 'analyze':
                    const findings = this.analyzer.analyze(msg.code);
                    this.panel.webview.postMessage({ command: 'analyzeResult', data: findings });
                    break;
                case 'getInfo':
                    const info = getCompilerInfo();
                    this.panel.webview.postMessage({
                        command: 'info',
                        data: {
                            compiler: info.compiler || 'none (using reference data)',
                            arch: info.arch,
                            mode: this.analyzer.getMode(),
                            hasCompiler: hasLocalBenchmarks(),
                        },
                    });
                    break;
                case 'openExternal':
                    vscode.env.openExternal(vscode.Uri.parse(msg.url));
                    break;
            }
        });
    }

    private getHtml(): string {
        return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com;">
    <title>LatencyLens</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
${DASHBOARD_CSS}
    </style>
</head>
<body>
    <header>
        <div class="logo">
            <span class="logo-icon">L</span>
            <h1>LatencyLens</h1>
            <span class="subtitle">C++ Performance Observatory</span>
        </div>
        <div class="sys-info" id="sysInfo">
            <span class="chip" id="chipCompiler">—</span>
            <span class="chip" id="chipArch">—</span>
            <span class="chip" id="chipMode">—</span>
        </div>
    </header>

    <nav class="tabs">
        <button class="tab active" data-tab="patterns">Pattern Explorer</button>
        <button class="tab" data-tab="analyze">Code Analyzer</button>
    </nav>

    <main id="view-patterns" class="view active">
        <div class="patterns-grid" id="patternsGrid"></div>
        <div class="detail-panel hidden" id="detailPanel">
            <button class="close-btn" id="closeDetail">&times;</button>
            <div class="detail-header">
                <span class="detail-category" id="detailCategory"></span>
                <h2 id="detailName"></h2>
                <p id="detailDesc"></p>
            </div>
            <div class="detail-explanation" id="detailExplanation"></div>
            <div class="code-comparison">
                <div class="code-block before">
                    <div class="code-label"><span class="dot red"></span><span id="beforeLabel">Before</span></div>
                    <pre><code id="beforeCode"></code></pre>
                </div>
                <div class="code-block after">
                    <div class="code-label"><span class="dot green"></span><span id="afterLabel">After</span></div>
                    <pre><code id="afterCode"></code></pre>
                </div>
            </div>
            <div class="bench-controls">
                <div class="size-selector">
                    <label>Data Size:</label>
                    <select id="benchSize">
                        <option value="1000">1K</option>
                        <option value="10000">10K</option>
                        <option value="100000" selected>100K</option>
                        <option value="1000000">1M</option>
                        <option value="5000000">5M</option>
                        <option value="10000000">10M</option>
                    </select>
                </div>
                <button class="btn-primary" id="btnRunBenchmark">Run Dynamic Analysis</button>
                <button class="btn-secondary" id="btnRunScaling">Scaling Profile</button>
            </div>
            <div class="results-area hidden" id="resultsArea">
                <div class="bench-source hidden" id="benchSource"></div>
                <div class="result-cards">
                    <div class="result-card">
                        <span class="result-label" id="resultBeforeLabel">Before</span>
                        <span class="result-value red" id="resultBefore">—</span>
                    </div>
                    <div class="result-card accent">
                        <span class="result-label">Speedup</span>
                        <span class="result-value gold" id="resultSpeedup">—</span>
                    </div>
                    <div class="result-card">
                        <span class="result-label" id="resultAfterLabel">After</span>
                        <span class="result-value green" id="resultAfter">—</span>
                    </div>
                </div>
                <div class="chart-container"><canvas id="benchChart"></canvas></div>
            </div>
            <div class="scaling-area hidden" id="scalingArea">
                <h3>Scaling Profile</h3>
                <div class="chart-container wide"><canvas id="scalingChart"></canvas></div>
            </div>
        </div>
    </main>

    <main id="view-analyze" class="view">
        <div class="analyzer-container">
            <div class="analyzer-input">
                <h2>Paste your C++ code</h2>
                <p>LatencyLens will scan for structural performance issues and let you attach dynamic evidence to each fix.</p>
                <textarea id="codeInput" placeholder="// Paste your C++ code here..."></textarea>
                <button class="btn-primary" id="btnAnalyze">Analyze Code</button>
            </div>
            <div class="analyzer-results hidden" id="analyzerResults">
                <h2>Findings <span class="finding-count" id="findingCount"></span></h2>
                <div id="findingsList"></div>
            </div>
        </div>
    </main>

    <script>
${DASHBOARD_JS}
    </script>
</body>
</html>`;
    }
}

// ── Inlined CSS & JS (from web/ assets, adapted for webview) ──

const DASHBOARD_CSS = `
:root {
    --bg-primary: var(--vscode-editor-background, #0a0a0f);
    --bg-secondary: var(--vscode-sideBar-background, #12121a);
    --bg-card: var(--vscode-editorWidget-background, #1a1a25);
    --bg-card-hover: #22222f;
    --bg-code: var(--vscode-textCodeBlock-background, #0d0d14);
    --border: var(--vscode-widget-border, #2a2a3a);
    --border-accent: #3a3a50;
    --text-primary: var(--vscode-editor-foreground, #e8e8f0);
    --text-secondary: var(--vscode-descriptionForeground, #8888a0);
    --text-muted: #555570;
    --accent-red: #ff4757;
    --accent-red-dim: #ff475730;
    --accent-green: #2ed573;
    --accent-green-dim: #2ed57330;
    --accent-gold: #ffa502;
    --accent-gold-dim: #ffa50230;
    --accent-blue: #3742fa;
    --accent-cyan: #00d2d3;
    --font-mono: 'JetBrains Mono', var(--vscode-editor-font-family, monospace);
    --font-sans: 'Inter', var(--vscode-font-family, sans-serif);
    --radius: 12px;
    --radius-sm: 8px;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: var(--font-sans); background: var(--bg-primary); color: var(--text-primary); min-height: 100vh; }
header { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; border-bottom: 1px solid var(--border); background: var(--bg-secondary); }
.logo { display: flex; align-items: center; gap: 10px; }
.logo-icon { font-size: 24px; }
.logo h1 { font-size: 18px; font-weight: 800; }
.subtitle { font-size: 12px; color: var(--text-muted); font-weight: 500; padding-left: 10px; border-left: 1px solid var(--border); }
.sys-info { display: flex; gap: 6px; }
.chip { font-family: var(--font-mono); font-size: 10px; padding: 3px 8px; border-radius: 20px; background: var(--bg-card); color: var(--text-secondary); border: 1px solid var(--border); }
.tabs { display: flex; padding: 0 24px; background: var(--bg-secondary); border-bottom: 1px solid var(--border); }
.tab { background: none; border: none; color: var(--text-muted); font-family: var(--font-sans); font-size: 13px; font-weight: 600; padding: 12px 20px; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.2s; }
.tab:hover { color: var(--text-secondary); }
.tab.active { color: var(--text-primary); border-bottom-color: var(--accent-cyan); }
.view { display: none; padding: 24px; }
.view.active { display: block; }
.patterns-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; margin-bottom: 24px; }
.pattern-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; cursor: pointer; transition: all 0.2s; }
.pattern-card:hover { background: var(--bg-card-hover); border-color: var(--border-accent); transform: translateY(-1px); }
.pattern-card.active { border-color: var(--accent-cyan); }
.pattern-card .category { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: var(--accent-cyan); margin-bottom: 6px; }
.pattern-card h3 { font-size: 14px; font-weight: 700; margin-bottom: 4px; font-family: var(--font-mono); }
.pattern-card p { font-size: 12px; color: var(--text-secondary); line-height: 1.4; }
.detail-panel { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px; margin-top: 16px; position: relative; animation: slideUp 0.25s ease; }
@keyframes slideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
.close-btn { position: absolute; top: 12px; right: 12px; background: var(--bg-card); border: 1px solid var(--border); color: var(--text-secondary); width: 28px; height: 28px; border-radius: 50%; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; }
.close-btn:hover { background: var(--accent-red-dim); color: var(--accent-red); }
.detail-category { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: var(--accent-cyan); }
.detail-header h2 { font-size: 20px; font-weight: 800; margin: 6px 0; font-family: var(--font-mono); }
.detail-header p { color: var(--text-secondary); font-size: 13px; }
.detail-explanation { background: var(--bg-card); border: 1px solid var(--border); border-left: 3px solid var(--accent-gold); border-radius: var(--radius-sm); padding: 14px 16px; margin: 16px 0; font-size: 13px; line-height: 1.6; color: var(--text-secondary); }
.code-comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
.code-block { background: var(--bg-code); border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
.code-block.before { border-top: 2px solid var(--accent-red); }
.code-block.after { border-top: 2px solid var(--accent-green); }
.code-label { display: flex; align-items: center; gap: 6px; padding: 8px 12px; font-size: 11px; font-weight: 600; color: var(--text-secondary); border-bottom: 1px solid var(--border); background: var(--bg-card); }
.dot { width: 7px; height: 7px; border-radius: 50%; }
.dot.red { background: var(--accent-red); }
.dot.green { background: var(--accent-green); }
.code-block pre { padding: 12px; overflow-x: auto; }
.code-block code { font-family: var(--font-mono); font-size: 12px; line-height: 1.5; color: var(--text-primary); white-space: pre; }
.bench-controls { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.size-selector { display: flex; align-items: center; gap: 6px; }
.size-selector label { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
.size-selector select { background: var(--bg-card); border: 1px solid var(--border); color: var(--text-primary); font-family: var(--font-mono); font-size: 12px; padding: 6px 10px; border-radius: var(--radius-sm); }
.btn-primary, .btn-secondary { font-family: var(--font-sans); font-size: 13px; font-weight: 600; padding: 8px 20px; border-radius: var(--radius-sm); cursor: pointer; transition: all 0.2s; border: none; }
.btn-primary { background: linear-gradient(135deg, var(--accent-cyan), var(--accent-blue)); color: white; }
.btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0, 210, 211, 0.3); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
.btn-secondary { background: var(--bg-card); border: 1px solid var(--border); color: var(--text-secondary); }
.btn-secondary:hover { background: var(--bg-card-hover); color: var(--text-primary); }
.hidden { display: none !important; }
.result-cards { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 16px; }
.result-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; text-align: center; }
.result-card.accent { background: var(--accent-gold-dim); border-color: var(--accent-gold); }
.result-label { display: block; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); margin-bottom: 6px; }
.result-value { display: block; font-size: 28px; font-weight: 800; font-family: var(--font-mono); }
.result-value.red { color: var(--accent-red); }
.result-value.green { color: var(--accent-green); }
.result-value.gold { color: var(--accent-gold); }
.chart-container { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; height: 260px; }
.chart-container.wide { height: 300px; }
.scaling-area { margin-top: 16px; animation: slideUp 0.25s ease; }
.scaling-area h3 { font-size: 16px; margin-bottom: 12px; }
.analyzer-container { max-width: 1000px; }
.analyzer-input h2 { font-size: 20px; font-weight: 800; margin-bottom: 6px; }
.analyzer-input p { font-size: 13px; color: var(--text-secondary); margin-bottom: 12px; }
textarea { width: 100%; height: 250px; background: var(--bg-code); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-primary); font-family: var(--font-mono); font-size: 13px; line-height: 1.5; padding: 16px; resize: vertical; margin-bottom: 12px; }
textarea:focus { outline: none; border-color: var(--accent-cyan); }
.finding-count { font-size: 13px; font-weight: 600; background: var(--accent-red-dim); color: var(--accent-red); padding: 2px 8px; border-radius: 20px; }
.analyzer-results h2 { font-size: 18px; font-weight: 700; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
.finding-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; margin-bottom: 12px; }
.finding-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
.finding-card h3 { font-family: var(--font-mono); font-size: 14px; }
.severity { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px; text-transform: uppercase; }
.severity.high { background: var(--accent-red-dim); color: var(--accent-red); }
.severity.medium { background: var(--accent-gold-dim); color: var(--accent-gold); }
.severity.low { background: rgba(136,136,160,0.15); color: var(--text-secondary); }
.finding-card .matches { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin-bottom: 10px; }
.finding-card .explanation { font-size: 13px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 12px; }
.finding-card .bench-btn { background: linear-gradient(135deg, var(--accent-cyan), var(--accent-blue)); color: white; border: none; font-size: 12px; font-weight: 600; padding: 6px 16px; border-radius: var(--radius-sm); cursor: pointer; }
.finding-card .bench-result { margin-top: 12px; padding: 12px; background: var(--bg-secondary); border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: 13px; }
@media (max-width: 600px) { .code-comparison { grid-template-columns: 1fr; } .result-cards { grid-template-columns: 1fr; } .patterns-grid { grid-template-columns: 1fr; } }
.bench-source { margin-bottom: 12px; }
.badge { display: inline-block; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 20px; }
.badge.local { background: var(--accent-green-dim); color: var(--accent-green); }
.badge.reference { background: var(--accent-gold-dim); color: var(--accent-gold); }
.bench-note { display: block; font-size: 11px; color: var(--text-muted); margin-top: 4px; font-style: italic; }
.bench-error { display: block; margin-top: 8px; color: var(--accent-red); font-size: 12px; }
`;

const DASHBOARD_JS = `
const vscode = acquireVsCodeApi();
let patterns = [], currentPattern = null, benchChart = null, scalingChart = null;

// ── Message-based API (replaces HTTP fetch) ─────────────────

const pending = {};
let msgId = 0;

function postMsg(command, data) {
    vscode.postMessage({ command, ...data });
}

window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.command) {
        case 'patterns': patterns = msg.data; renderPatternGrid(); break;
        case 'patternDetail': currentPattern = msg.data; renderDetail(msg.data); break;
        case 'benchmarkResult': handleBenchResult(msg.data); break;
        case 'scalingResult': handleScalingResult(msg.data); break;
        case 'analyzeResult': renderFindings(msg.data || []); break;
        case 'info':
            document.getElementById('chipCompiler').textContent = msg.data.compiler || '—';
            document.getElementById('chipArch').textContent = msg.data.arch || '—';
            document.getElementById('chipMode').textContent = msg.data.mode || '—';
            break;
    }
});

document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    postMsg('getInfo');
    postMsg('getPatterns');
    setupEventListeners();
});

function setupTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('view-' + tab.dataset.tab).classList.add('active');
        });
    });
}

function renderPatternGrid() {
    const grid = document.getElementById('patternsGrid');
    grid.innerHTML = patterns.map(p =>
        '<div class="pattern-card" data-id="' + p.id + '">' +
        '<div class="category">' + p.category + '</div>' +
        '<h3>' + p.name + '</h3>' +
        '<p>' + p.short_desc + '</p></div>'
    ).join('');
    grid.querySelectorAll('.pattern-card').forEach(c => c.addEventListener('click', () => selectPattern(c.dataset.id)));
}

function selectPattern(id) {
    document.querySelectorAll('.pattern-card').forEach(c => c.classList.remove('active'));
    const card = document.querySelector('[data-id="' + id + '"]');
    if (card) card.classList.add('active');
    postMsg('getPattern', { id });
}

function renderDetail(p) {
    const panel = document.getElementById('detailPanel');
    panel.classList.remove('hidden');
    document.getElementById('detailCategory').textContent = p.category;
    document.getElementById('detailName').textContent = p.name;
    document.getElementById('detailDesc').textContent = p.short_desc;
    document.getElementById('detailExplanation').textContent = p.explanation;
    document.getElementById('beforeLabel').textContent = p.before_label;
    document.getElementById('afterLabel').textContent = p.after_label;
    document.getElementById('beforeCode').textContent = p.before_snippet;
    document.getElementById('afterCode').textContent = p.after_snippet;
    document.getElementById('resultBeforeLabel').textContent = p.before_label;
    document.getElementById('resultAfterLabel').textContent = p.after_label;
    document.getElementById('resultsArea').classList.add('hidden');
    document.getElementById('scalingArea').classList.add('hidden');
    panel.scrollIntoView({ behavior: 'smooth' });
}

function setupEventListeners() {
    document.getElementById('closeDetail').addEventListener('click', () => {
        document.getElementById('detailPanel').classList.add('hidden');
        document.querySelectorAll('.pattern-card').forEach(c => c.classList.remove('active'));
        currentPattern = null;
    });
    document.getElementById('btnRunBenchmark').addEventListener('click', runBenchmark);
    document.getElementById('btnRunScaling').addEventListener('click', runScaling);
    document.getElementById('btnAnalyze').addEventListener('click', analyzeCode);
}

function runBenchmark() {
    if (!currentPattern) return;
    const btn = document.getElementById('btnRunBenchmark');
    btn.disabled = true; btn.textContent = 'Profiling...';
    postMsg('runBenchmark', {
        patternId: currentPattern.id,
        dataSize: parseInt(document.getElementById('benchSize').value)
    });
}

function handleBenchResult(result) {
    const btn = document.getElementById('btnRunBenchmark');
    btn.disabled = false; btn.textContent = 'Run Dynamic Analysis';
    if (result.error) { renderBenchError(result.error); return; }
    renderBenchResult(result);
}

function renderBenchError(message) {
    const resultsArea = document.getElementById('resultsArea');
    const scalingArea = document.getElementById('scalingArea');
    const srcEl = document.getElementById('benchSource');
    resultsArea.classList.remove('hidden');
    scalingArea.classList.add('hidden');
    srcEl.classList.remove('hidden');
    srcEl.innerHTML = '<span class="bench-error">' + esc(message) + '</span>';
}

function renderBenchResult(result) {
    document.getElementById('resultsArea').classList.remove('hidden');
    document.getElementById('resultBefore').textContent = fmtNs(result.before_ns);
    document.getElementById('resultAfter').textContent = fmtNs(result.after_ns);
    document.getElementById('resultSpeedup').textContent = result.speedup + '×';

    // Show source badge (local vs reference)
    const srcEl = document.getElementById('benchSource');
    srcEl.classList.remove('hidden');
    if (result.source === 'local') {
        srcEl.innerHTML = '<span class="badge local">Live benchmark on your hardware</span>';
    } else {
        srcEl.innerHTML = '<span class="badge reference">Reference data - install clang++/g++ for live benchmarks</span>';
    }
    if (result.note) {
        srcEl.innerHTML += '<span class="bench-note">' + result.note + '</span>';
    }

    const ctx = document.getElementById('benchChart').getContext('2d');
    if (benchChart) benchChart.destroy();
    benchChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: [currentPattern.before_label, currentPattern.after_label],
            datasets: [{ data: [result.before_ns, result.after_ns],
                backgroundColor: ['rgba(255,71,87,0.7)','rgba(46,213,115,0.7)'],
                borderColor: ['rgba(255,71,87,1)','rgba(46,213,115,1)'], borderWidth: 2, borderRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false },
                title: { display: true, text: currentPattern.name + ' — ' + result.speedup + '× speedup', color: '#e8e8f0', font: { size: 13, weight: '600' } } },
            scales: { y: { beginAtZero: true, grid: { color: 'rgba(42,42,58,0.5)' }, ticks: { color: '#8888a0', font: { family: 'JetBrains Mono', size: 10 }, callback: v => fmtNs(v) } },
                x: { grid: { display: false }, ticks: { color: '#e8e8f0', font: { family: 'JetBrains Mono', size: 11, weight: '600' } } } } }
    });
}

function runScaling() {
    if (!currentPattern) return;
    const btn = document.getElementById('btnRunScaling');
    btn.disabled = true; btn.textContent = 'Profiling...';
    postMsg('runScaling', {
        patternId: currentPattern.id,
        sizes: [1000,5000,10000,50000,100000,500000,1000000]
    });
}

function handleScalingResult(data) {
    const btn = document.getElementById('btnRunScaling');
    btn.disabled = false; btn.textContent = 'Scaling Profile';
    if (data.error) { renderBenchError(data.error); return; }
    if (Array.isArray(data)) renderScaling(data);
}

function renderScaling(results) {
    const area = document.getElementById('scalingArea');
    area.classList.remove('hidden');
    const ctx = document.getElementById('scalingChart').getContext('2d');
    if (scalingChart) scalingChart.destroy();
    const valid = results.filter(r => !r.error);
    scalingChart = new Chart(ctx, {
        type: 'line',
        data: { labels: valid.map(r => fmtSize(r.data_size)),
            datasets: [
                { label: currentPattern.before_label, data: valid.map(r => r.before_ns), borderColor: 'rgba(255,71,87,1)', backgroundColor: 'rgba(255,71,87,0.1)', fill: true, tension: 0.3, pointRadius: 4, borderWidth: 2 },
                { label: currentPattern.after_label, data: valid.map(r => r.after_ns), borderColor: 'rgba(46,213,115,1)', backgroundColor: 'rgba(46,213,115,0.1)', fill: true, tension: 0.3, pointRadius: 4, borderWidth: 2 }
            ] },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { color: '#e8e8f0', font: { family: 'JetBrains Mono', size: 11 } } },
                title: { display: true, text: 'Scaling: ' + currentPattern.name, color: '#e8e8f0', font: { size: 13, weight: '600' } } },
            scales: { y: { beginAtZero: true, grid: { color: 'rgba(42,42,58,0.5)' }, ticks: { color: '#8888a0', font: { family: 'JetBrains Mono', size: 10 }, callback: v => fmtNs(v) } },
                x: { grid: { color: 'rgba(42,42,58,0.3)' }, ticks: { color: '#8888a0', font: { family: 'JetBrains Mono', size: 10 } } } } }
    });
}

function analyzeCode() {
    const code = document.getElementById('codeInput').value;
    if (!code.trim()) return;
    const btn = document.getElementById('btnAnalyze');
    btn.disabled = true; btn.textContent = 'Scanning...';
    postMsg('analyze', { code });
    // Re-enable after a short delay (result comes async)
    setTimeout(() => { btn.disabled = false; btn.textContent = 'Analyze Code'; }, 500);
}

function renderFindings(findings) {
    const c = document.getElementById('analyzerResults');
    const list = document.getElementById('findingsList');
    c.classList.remove('hidden');
    document.getElementById('findingCount').textContent = findings.length;
    if (!findings.length) { list.innerHTML = '<div class="finding-card"><h3 style="color:var(--accent-green)">No anti-patterns detected</h3></div>'; return; }
    list.innerHTML = findings.map((f,i) =>
        '<div class="finding-card"><div class="finding-header"><h3>' + f.pattern_name + '</h3><span class="severity ' + f.severity + '">' + f.severity + '</span></div>' +
        '<div class="matches">Line' + (f.matches.length>1?'s':'') + ': ' + f.matches.map(m => '<strong>' + m.line + '</strong>').join(', ') + '</div>' +
        '<div class="explanation">' + f.explanation + '</div>' +
        '<div class="code-comparison"><div class="code-block before"><div class="code-label"><span class="dot red"></span>' + f.before_label + '</div><pre><code>' + esc(f.before_snippet) + '</code></pre></div>' +
        '<div class="code-block after"><div class="code-label"><span class="dot green"></span>' + f.after_label + '</div><pre><code>' + esc(f.after_snippet) + '</code></pre></div></div>' +
        '<button class="bench-btn" onclick="benchFinding(\\'' + f.pattern_id + '\\',' + i + ')">Run Dynamic Analysis</button>' +
        '<div class="bench-result hidden" id="fr-' + i + '"></div></div>'
    ).join('');
}

// Store pending finding benchmarks
const findingBenchCallbacks = {};

function benchFinding(pid, idx) {
    const el = document.getElementById('fr-' + idx);
    el.classList.remove('hidden'); el.innerHTML = '<span style="opacity:0.6">Running dynamic analysis...</span>';
    findingBenchCallbacks[pid] = el;
    postMsg('runBenchmark', { patternId: pid, dataSize: 100000 });
}

// Patch handleBenchResult to also handle finding benchmarks
const _origHandleBench = handleBenchResult;

function fmtNs(ns) { if(ns>=1e9)return(ns/1e9).toFixed(2)+'s';if(ns>=1e6)return(ns/1e6).toFixed(2)+'ms';if(ns>=1e3)return(ns/1e3).toFixed(1)+'µs';return Math.round(ns)+'ns'; }
function fmtSize(n) { if(n>=1e6)return(n/1e6)+'M';if(n>=1e3)return(n/1e3)+'K';return n; }
function esc(t) { const d=document.createElement('div');d.textContent=t;return d.innerHTML; }
`;
