/**
 * LatencyLens — Frontend Application
 *
 * Connects to the Flask API, renders pattern cards,
 * runs benchmarks, and displays results with Chart.js.
 */

const API = '';  // Same origin

// ── State ────────────────────────────────────────────────

let patterns = [];
let currentPattern = null;
let benchChart = null;
let scalingChart = null;

// ── Chart.js theme defaults ──────────────────────────────

const CHART_COLORS = {
    red:      'rgba(199, 84, 80, 1)',
    redFill:  'rgba(199, 84, 80, 0.12)',
    green:    'rgba(126, 168, 126, 1)',
    greenFill:'rgba(126, 168, 126, 0.12)',
    grid:     'rgba(51, 51, 42, 0.6)',
    gridLight:'rgba(51, 51, 42, 0.3)',
    text:     '#a09b8a',
    textBright:'#e8e4d9',
    bar: {
        before: 'rgba(199, 84, 80, 0.75)',
        after:  'rgba(126, 168, 126, 0.75)',
        beforeBorder: 'rgba(199, 84, 80, 1)',
        afterBorder:  'rgba(126, 168, 126, 1)',
    },
};

// ── Init ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    setupTabs();
    await loadSystemInfo();
    await loadPatterns();
    setupEventListeners();
});

// ── Tabs ─────────────────────────────────────────────────

function setupTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`view-${tab.dataset.tab}`).classList.add('active');
        });
    });
}

// ── System Info ──────────────────────────────────────────

async function loadSystemInfo() {
    try {
        const resp = await fetch(`${API}/api/info`);
        const info = await resp.json();
        document.getElementById('chipCompiler').textContent = info.compiler || 'no compiler';
        document.getElementById('chipArch').textContent = info.arch || 'unknown';
        document.getElementById('footerCompiler').textContent = info.compiler || 'clang++';
    } catch (e) {
        console.error('Failed to load system info:', e);
    }
}

// ── Load Patterns ────────────────────────────────────────

async function loadPatterns() {
    try {
        const resp = await fetch(`${API}/api/patterns`);
        patterns = await resp.json();
        renderPatternGrid();
    } catch (e) {
        console.error('Failed to load patterns:', e);
    }
}

function renderPatternGrid() {
    const grid = document.getElementById('patternsGrid');
    grid.innerHTML = patterns.map((p, i) => `
        <div class="pattern-card" data-id="${p.id}" style="animation-delay: ${i * 0.06}s">
            <div class="category">${p.category}</div>
            <h3>${p.name}</h3>
            <p>${p.short_desc}</p>
        </div>
    `).join('');

    grid.querySelectorAll('.pattern-card').forEach(card => {
        card.addEventListener('click', () => selectPattern(card.dataset.id));
    });
}

// ── Select Pattern ───────────────────────────────────────

async function selectPattern(patternId) {
    document.querySelectorAll('.pattern-card').forEach(c => c.classList.remove('active'));
    const card = document.querySelector(`[data-id="${patternId}"]`);
    if (card) card.classList.add('active');

    try {
        const resp = await fetch(`${API}/api/patterns/${patternId}`);
        const detail = await resp.json();
        currentPattern = detail;
        renderDetail(detail);
    } catch (e) {
        console.error('Failed to load pattern detail:', e);
    }
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

    // Reset results
    document.getElementById('resultsArea').classList.add('hidden');
    document.getElementById('scalingArea').classList.add('hidden');

    // Scroll to panel
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Event Listeners ──────────────────────────────────────

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

// ── Run Benchmark ────────────────────────────────────────

async function runBenchmark() {
    if (!currentPattern) return;

    const btn = document.getElementById('btnRunBenchmark');
    const btnText = btn.querySelector('.btn-text');
    const btnLoading = btn.querySelector('.btn-loading');
    const size = parseInt(document.getElementById('benchSize').value);

    btn.disabled = true;
    btnText.classList.add('hidden');
    btnLoading.classList.remove('hidden');

    try {
        const resp = await fetch(`${API}/api/benchmark/${currentPattern.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data_size: size }),
        });
        const result = await resp.json();

        if (result.error) {
            alert(`Benchmark error: ${result.error}`);
            return;
        }

        renderBenchmarkResult(result);
    } catch (e) {
        alert(`Request failed: ${e.message}`);
    } finally {
        btn.disabled = false;
        btnText.classList.remove('hidden');
        btnLoading.classList.add('hidden');
    }
}

function renderBenchmarkResult(result) {
    const area = document.getElementById('resultsArea');
    area.classList.remove('hidden');

    document.getElementById('resultBefore').textContent = formatNs(result.before_ns);
    document.getElementById('resultAfter').textContent = formatNs(result.after_ns);
    document.getElementById('resultSpeedup').textContent = result.speedup + '×';

    renderBenchChart(result);
}

function renderBenchChart(result) {
    const ctx = document.getElementById('benchChart').getContext('2d');
    if (benchChart) benchChart.destroy();

    benchChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [currentPattern.before_label, currentPattern.after_label],
            datasets: [{
                label: 'Time (ns)',
                data: [result.before_ns, result.after_ns],
                backgroundColor: [CHART_COLORS.bar.before, CHART_COLORS.bar.after],
                borderColor: [CHART_COLORS.bar.beforeBorder, CHART_COLORS.bar.afterBorder],
                borderWidth: 2,
                borderRadius: 6,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                title: {
                    display: true,
                    text: `${currentPattern.name} — ${result.speedup}× speedup (N=${result.data_size?.toLocaleString()})`,
                    color: CHART_COLORS.textBright,
                    font: { size: 13, weight: '600', family: 'Syne' },
                    padding: { bottom: 16 },
                },
                tooltip: {
                    backgroundColor: '#262620',
                    borderColor: '#33332a',
                    borderWidth: 1,
                    titleFont: { family: 'Syne', weight: '700' },
                    bodyFont: { family: 'IBM Plex Mono' },
                    callbacks: {
                        label: (ctx) => formatNs(ctx.parsed.y),
                    },
                },
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: CHART_COLORS.grid },
                    ticks: {
                        color: CHART_COLORS.text,
                        font: { family: 'IBM Plex Mono', size: 11 },
                        callback: (v) => formatNs(v),
                    },
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        color: CHART_COLORS.textBright,
                        font: { family: 'IBM Plex Mono', size: 12, weight: '600' },
                    },
                },
            },
        },
    });
}

// ── Scaling Benchmark ────────────────────────────────────

async function runScaling() {
    if (!currentPattern) return;

    const btn = document.getElementById('btnRunScaling');
    btn.disabled = true;
    btn.textContent = 'Running scaling analysis…';

    try {
        const resp = await fetch(`${API}/api/benchmark/${currentPattern.id}/scale`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sizes: [1000, 5000, 10000, 50000, 100000, 500000, 1000000],
            }),
        });
        const data = await resp.json();

        if (data.results) {
            renderScalingChart(data.results);
        }
    } catch (e) {
        alert(`Scaling failed: ${e.message}`);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Run Scaling Analysis';
    }
}

function renderScalingChart(results) {
    const area = document.getElementById('scalingArea');
    area.classList.remove('hidden');
    area.scrollIntoView({ behavior: 'smooth' });

    const ctx = document.getElementById('scalingChart').getContext('2d');
    if (scalingChart) scalingChart.destroy();

    const valid = results.filter(r => !r.error);
    const labels = valid.map(r => formatSize(r.data_size));
    const beforeData = valid.map(r => r.before_ns);
    const afterData = valid.map(r => r.after_ns);

    scalingChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: currentPattern.before_label,
                    data: beforeData,
                    borderColor: CHART_COLORS.red,
                    backgroundColor: CHART_COLORS.redFill,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    pointBackgroundColor: CHART_COLORS.red,
                    borderWidth: 2,
                },
                {
                    label: currentPattern.after_label,
                    data: afterData,
                    borderColor: CHART_COLORS.green,
                    backgroundColor: CHART_COLORS.greenFill,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    pointBackgroundColor: CHART_COLORS.green,
                    borderWidth: 2,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    labels: {
                        color: CHART_COLORS.textBright,
                        font: { family: 'IBM Plex Mono', size: 11 },
                        boxWidth: 12,
                        boxHeight: 2,
                    },
                },
                title: {
                    display: true,
                    text: `Scaling: ${currentPattern.name}`,
                    color: CHART_COLORS.textBright,
                    font: { size: 13, weight: '600', family: 'Syne' },
                    padding: { bottom: 16 },
                },
                tooltip: {
                    backgroundColor: '#262620',
                    borderColor: '#33332a',
                    borderWidth: 1,
                    titleFont: { family: 'Syne', weight: '700' },
                    bodyFont: { family: 'IBM Plex Mono' },
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${formatNs(ctx.parsed.y)}`,
                    },
                },
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: CHART_COLORS.grid },
                    ticks: {
                        color: CHART_COLORS.text,
                        font: { family: 'IBM Plex Mono', size: 11 },
                        callback: (v) => formatNs(v),
                    },
                    title: {
                        display: true,
                        text: 'Time',
                        color: CHART_COLORS.text,
                        font: { family: 'Syne', size: 11, weight: '600' },
                    },
                },
                x: {
                    grid: { color: CHART_COLORS.gridLight },
                    ticks: {
                        color: CHART_COLORS.text,
                        font: { family: 'IBM Plex Mono', size: 11 },
                    },
                    title: {
                        display: true,
                        text: 'Data Size (elements)',
                        color: CHART_COLORS.text,
                        font: { family: 'Syne', size: 11, weight: '600' },
                    },
                },
            },
        },
    });
}

// ── Code Analyzer ────────────────────────────────────────

async function analyzeCode() {
    const code = document.getElementById('codeInput').value;
    if (!code.trim()) return;

    const btn = document.getElementById('btnAnalyze');
    const btnText = btn.querySelector('.btn-text');
    const btnLoading = btn.querySelector('.btn-loading');

    btn.disabled = true;
    btnText.classList.add('hidden');
    btnLoading.classList.remove('hidden');

    try {
        const resp = await fetch(`${API}/api/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });
        const data = await resp.json();

        renderFindings(data.findings || []);
    } catch (e) {
        alert(`Analysis failed: ${e.message}`);
    } finally {
        btn.disabled = false;
        btnText.classList.remove('hidden');
        btnLoading.classList.add('hidden');
    }
}

function renderFindings(findings) {
    const container = document.getElementById('analyzerResults');
    const list = document.getElementById('findingsList');
    const count = document.getElementById('findingCount');

    container.classList.remove('hidden');
    count.textContent = findings.length;

    if (findings.length === 0) {
        list.innerHTML = `
            <div class="finding-card">
                <h3 style="color: var(--accent-green);">No anti-patterns detected</h3>
                <p style="color: var(--text-secondary); margin-top: 8px; font-style: italic;">
                    Your code looks clean! Try pasting code that uses std::map, std::list,
                    shared_ptr, virtual functions, or other common patterns.
                </p>
            </div>
        `;
        return;
    }

    list.innerHTML = findings.map((f, i) => `
        <div class="finding-card" style="animation: panelSlideUp 0.4s cubic-bezier(0.22, 1, 0.36, 1) ${i * 0.08}s both;">
            <div class="finding-header">
                <h3>${f.pattern_name}</h3>
                <span class="severity ${f.severity}">${f.severity}</span>
            </div>
            <div class="matches">
                Found on line${f.matches.length > 1 ? 's' : ''}: 
                ${f.matches.map(m => `<strong>${m.line}</strong>`).join(', ')}
            </div>
            <div class="explanation">${f.explanation}</div>
            <div class="code-comparison">
                <div class="code-block before">
                    <div class="code-label">
                        <span class="dot red"></span>
                        <span>${f.before_label}</span>
                    </div>
                    <pre><code>${escapeHtml(f.before_snippet)}</code></pre>
                </div>
                <div class="code-block after">
                    <div class="code-label">
                        <span class="dot green"></span>
                        <span>${f.after_label}</span>
                    </div>
                    <pre><code>${escapeHtml(f.after_snippet)}</code></pre>
                </div>
            </div>
            <button class="bench-btn" onclick="benchmarkFinding('${f.pattern_id}', ${i})">
                Benchmark This Pattern
            </button>
            <div class="bench-result hidden" id="findingResult-${i}"></div>
        </div>
    `).join('');
}

async function benchmarkFinding(patternId, index) {
    const resultEl = document.getElementById(`findingResult-${index}`);
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = '<span class="loading">Compiling & benchmarking…</span>';

    try {
        const resp = await fetch(`${API}/api/benchmark/${patternId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data_size: 100000 }),
        });
        const result = await resp.json();

        if (result.error) {
            resultEl.innerHTML = `<span style="color: var(--accent-red);">Error: ${result.error}</span>`;
            return;
        }

        resultEl.innerHTML = `
            <span style="color: var(--accent-red);">Before: ${formatNs(result.before_ns)}</span>
            &nbsp;&nbsp;→&nbsp;&nbsp;
            <span style="color: var(--accent-green);">After: ${formatNs(result.after_ns)}</span>
            &nbsp;&nbsp;
            <strong style="color: var(--accent-gold);">${result.speedup}× faster</strong>
        `;
    } catch (e) {
        resultEl.innerHTML = `<span style="color: var(--accent-red);">Failed: ${e.message}</span>`;
    }
}

// ── Utility ──────────────────────────────────────────────

function formatNs(ns) {
    if (ns >= 1e9) return (ns / 1e9).toFixed(2) + 's';
    if (ns >= 1e6) return (ns / 1e6).toFixed(2) + 'ms';
    if (ns >= 1e3) return (ns / 1e3).toFixed(1) + 'µs';
    return Math.round(ns) + 'ns';
}

function formatSize(n) {
    if (n >= 1e6) return (n / 1e6) + 'M';
    if (n >= 1e3) return (n / 1e3) + 'K';
    return n.toString();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
