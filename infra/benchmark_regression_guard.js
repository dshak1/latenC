#!/usr/bin/env node
/**
 * Deterministic regression guard for benchmark snapshots.
 *
 * Usage:
 *   node infra/benchmark_regression_guard.js --baseline a.json --current b.json
 */
const fs = require('fs');

function arg(name, fallback = '') {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1];
}

const baselinePath = arg('--baseline');
const currentPath = arg('--current');
const throughputThreshold = Number(arg('--throughput-threshold', '10'));
const p99Threshold = Number(arg('--p99-threshold', '15'));
const errorThreshold = Number(arg('--error-threshold', '0.2'));

if (!baselinePath || !currentPath) {
  console.error('Missing --baseline or --current.');
  process.exit(2);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const current = JSON.parse(fs.readFileSync(currentPath, 'utf8'));

const workloads = Object.keys(baseline.workloads || {});
const failures = [];

for (const workload of workloads) {
  if (!current.workloads || !current.workloads[workload]) {
    failures.push(`${workload}: missing from current snapshot`);
    continue;
  }

  const b = baseline.workloads[workload];
  const c = current.workloads[workload];
  const throughputDeltaPct = b.ops_per_sec > 0 ? ((c.ops_per_sec - b.ops_per_sec) / b.ops_per_sec) * 100 : 0;
  const p99DeltaPct = b.p99_ns > 0 ? ((c.p99_ns - b.p99_ns) / b.p99_ns) * 100 : 0;
  const errorDeltaPct = (c.error_rate_pct || 0) - (b.error_rate_pct || 0);

  const violated = [];
  if (throughputDeltaPct < -throughputThreshold) {
    violated.push(`throughput ${throughputDeltaPct.toFixed(1)}%`);
  }
  if (p99DeltaPct > p99Threshold) {
    violated.push(`p99 +${p99DeltaPct.toFixed(1)}%`);
  }
  if (errorDeltaPct > errorThreshold) {
    violated.push(`error +${errorDeltaPct.toFixed(2)}pp`);
  }

  const summary = `${workload}: throughput ${throughputDeltaPct.toFixed(1)}%, p99 ${p99DeltaPct.toFixed(1)}%, error Δ ${errorDeltaPct.toFixed(2)}pp`;
  if (violated.length) {
    failures.push(`${summary} (violations: ${violated.join(', ')})`);
  } else {
    console.log(`PASS ${summary}`);
  }
}

if (failures.length) {
  console.error('\nRegression guard failed:\n' + failures.map(f => `- ${f}`).join('\n'));
  process.exit(1);
}

console.log('\nRegression guard passed.');
