export interface WorkloadProfile {
  insertPct: number;
  lookupHitPct: number;
  lookupMissPct: number;
  erasePct: number;
  clearPerHour: number;
  avgValueBytes: number;
  mapLifetimeSeconds: number;
  repeatedIdRatePct: number;
}

export interface AdvisorRecommendation {
  advisorVersion: string;
  profile: WorkloadProfile;
  normalized: {
    totalOpPct: number;
  };
  recommendedMap: string;
  confidence: 'high' | 'medium' | 'low';
  scores: Record<string, number>;
  rationale: string[];
  workloadLabels: string[];
  followUpBenchmarks: string[];
}

export interface RegressionInput {
  baselineOpsPerSec: number;
  currentOpsPerSec: number;
  baselineP99Ns: number;
  currentP99Ns: number;
  baselineErrorRatePct: number;
  currentErrorRatePct: number;
  mapType: string;
  profile: WorkloadProfile;
}

export interface RegressionTriageReport {
  severity: 'critical' | 'high' | 'medium' | 'low';
  throughputDeltaPct: number;
  p99DeltaPct: number;
  errorDeltaPct: number;
  summary: string;
  likelyCauses: string[];
  immediateActions: string[];
  recommendedOwner: string;
}

const MAPS = {
  abslFlat: 'absl::flat_hash_map',
  stdUnordered: 'std::unordered_map',
  scratch: 'perfmap::ScratchHashMap',
  scratchIndirect: 'perfmap::ScratchIndirectHashMap',
  indirect: 'perfmap::IndirectHashMap',
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function recommendMap(input: WorkloadProfile): AdvisorRecommendation {
  const profile: WorkloadProfile = {
    insertPct: clamp(input.insertPct, 0, 100),
    lookupHitPct: clamp(input.lookupHitPct, 0, 100),
    lookupMissPct: clamp(input.lookupMissPct, 0, 100),
    erasePct: clamp(input.erasePct, 0, 100),
    clearPerHour: Math.max(0, input.clearPerHour),
    avgValueBytes: Math.max(1, input.avgValueBytes),
    mapLifetimeSeconds: Math.max(1, input.mapLifetimeSeconds),
    repeatedIdRatePct: clamp(input.repeatedIdRatePct, 0, 100),
  };

  const totalOpPct = profile.insertPct + profile.lookupHitPct + profile.lookupMissPct + profile.erasePct;

  const scores: Record<string, number> = {
    [MAPS.abslFlat]: 55,
    [MAPS.stdUnordered]: 38,
    [MAPS.scratch]: 20,
    [MAPS.scratchIndirect]: 20,
    [MAPS.indirect]: 25,
  };

  const workloadLabels: string[] = [];
  const rationale: string[] = [];

  const isScratchLifecycle = profile.clearPerHour >= 50 || profile.mapLifetimeSeconds <= 120;
  const isLargeValue = profile.avgValueBytes >= 256;
  const isReadHeavy = profile.lookupHitPct + profile.lookupMissPct >= 70;
  const isChurnHeavy = profile.erasePct >= 20 && profile.insertPct >= 20;

  if (isScratchLifecycle) {
    workloadLabels.push('scratch-rebuild');
    scores[MAPS.scratch] += 35;
    scores[MAPS.scratchIndirect] += 35;
    scores[MAPS.abslFlat] -= 8;
    rationale.push('High clear frequency / short lifetime suggests request- or batch-scoped scratch maps.');
  }

  if (isLargeValue) {
    workloadLabels.push('large-value');
    scores[MAPS.indirect] += 22;
    scores[MAPS.scratchIndirect] += 30;
    scores[MAPS.abslFlat] -= 4;
    rationale.push('Average value size is large, so decoupling payload storage can reduce probe-path memory traffic.');
  }

  if (isReadHeavy) {
    workloadLabels.push('read-heavy');
    scores[MAPS.abslFlat] += 16;
    scores[MAPS.indirect] += 8;
    rationale.push('Lookup-heavy mixes typically favor flat/open-addressing baselines for broad workloads.');
  }

  if (isChurnHeavy) {
    workloadLabels.push('churn-heavy');
    scores[MAPS.scratch] += 6;
    scores[MAPS.stdUnordered] -= 3;
    rationale.push('Insert+erase churn often benefits from lifecycle-aware clear/reset behavior.');
  }

  if (profile.repeatedIdRatePct >= 35) {
    workloadLabels.push('repeated-ids');
    scores[MAPS.scratch] += 8;
    scores[MAPS.scratchIndirect] += 8;
    rationale.push('High repeated ID rate aligns with per-request dedup/enrichment scratch workloads.');
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [recommendedMap, bestScore] = sorted[0];
  const secondScore = sorted[1]?.[1] ?? 0;
  const delta = bestScore - secondScore;

  let confidence: 'high' | 'medium' | 'low' = 'medium';
  if (delta >= 18) {
    confidence = 'high';
  } else if (delta < 8) {
    confidence = 'low';
  }

  const followUpBenchmarks = [
    'Run baseline comparison at N=16K and N=64K with --benchmark_min_time=0.03s.',
    'Track ops/s and p99 latency for hit-heavy and miss-heavy variants separately.',
    'Include at least one negative-control workload where a specialized map is expected to lose.',
  ];

  if (!rationale.length) {
    rationale.push('No strong specialization signals detected; use a strong general-purpose baseline first.');
  }

  return {
    advisorVersion: 'work-advisor-v1',
    profile,
    normalized: { totalOpPct },
    recommendedMap,
    confidence,
    scores,
    rationale,
    workloadLabels,
    followUpBenchmarks,
  };
}

export function triageRegression(input: RegressionInput): RegressionTriageReport {
  const throughputDeltaPct = input.baselineOpsPerSec > 0
    ? ((input.currentOpsPerSec - input.baselineOpsPerSec) / input.baselineOpsPerSec) * 100
    : 0;
  const p99DeltaPct = input.baselineP99Ns > 0
    ? ((input.currentP99Ns - input.baselineP99Ns) / input.baselineP99Ns) * 100
    : 0;
  const errorDeltaPct = input.currentErrorRatePct - input.baselineErrorRatePct;

  const degradation = Math.max(-throughputDeltaPct, p99DeltaPct, errorDeltaPct * 10);

  let severity: RegressionTriageReport['severity'] = 'low';
  if (degradation >= 30 || errorDeltaPct >= 1.0) {
    severity = 'critical';
  } else if (degradation >= 20 || errorDeltaPct >= 0.5) {
    severity = 'high';
  } else if (degradation >= 10 || errorDeltaPct >= 0.2) {
    severity = 'medium';
  }

  const likelyCauses: string[] = [];
  if (input.profile.avgValueBytes >= 256 && input.mapType.includes('flat')) {
    likelyCauses.push('Large payload pressure: probe-path cache behavior regressed for inline-heavy map layout.');
  }
  if (input.profile.clearPerHour >= 50 && !input.mapType.includes('Scratch')) {
    likelyCauses.push('Scratch lifecycle mismatch: frequent clear/rebuild on non-scratch map implementation.');
  }
  if (input.profile.erasePct >= 20) {
    likelyCauses.push('Churn pressure: erase-heavy workload likely increased probe chain/tombstone costs.');
  }
  if (errorDeltaPct > 0) {
    likelyCauses.push('Reliability regression detected: error rate increased compared to baseline.');
  }
  if (!likelyCauses.length) {
    likelyCauses.push('Likely infrastructure noise or config drift; validate instance type, compiler flags, and benchmark seed consistency.');
  }

  const immediateActions = [
    'Re-run the same benchmark seed 5-7 times and compare median + MAD variability.',
    'Run map-selection advisor with the current workload percentages before rolling forward.',
    'Check CI artifact diff (ops/s + p99 + error rate) and bisect recent commits touching map/benchmark logic.',
  ];

  const summary = `Throughput ${throughputDeltaPct.toFixed(1)}%, p99 ${p99DeltaPct.toFixed(1)}%, error Δ ${errorDeltaPct.toFixed(2)}pp.`;

  return {
    severity,
    throughputDeltaPct,
    p99DeltaPct,
    errorDeltaPct,
    summary,
    likelyCauses,
    immediateActions,
    recommendedOwner: severity === 'critical' || severity === 'high' ? 'oncall-performance' : 'map-maintainer',
  };
}
