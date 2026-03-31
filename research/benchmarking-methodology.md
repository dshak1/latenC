# Research Note: Statistically Rigorous Benchmarking for LatencyLens

## Motivation
LatencyLens is strongest when benchmark output is trustworthy. A single run can be noisy due to scheduler jitter, thermal state, and background activity.

## Source
- Andy Georges, Dries Buytaert, Lieven Eeckhout.
  **"Statistically Rigorous Java Performance Evaluation"** (OOPSLA 2007).
  https://dri.es/files/oopsla07-georges.pdf

## Key takeaway applied
Even though the paper uses JVM workloads, its measurement principles are language-agnostic:
1. Use multiple independent measurements (not one run).
2. Prefer robust summaries (median/intervals) over cherry-picked best values.
3. Report uncertainty/variability so users can judge confidence.

## Implementation in this repo
In `extension/src/benchmarkRunner.ts`, local benchmarks now:
- Execute each benchmark binary 7 times.
- Aggregate `before_ns` and `after_ns` with median.
- Compute robust variability using MAD/median (%).
- Emit confidence tags (`high` / `medium` / `low`) based on observed variability.
- Surface this in benchmark notes (sample count + variability + confidence).

This keeps LatencyLens practical while making the benchmark signal much harder to misinterpret.
