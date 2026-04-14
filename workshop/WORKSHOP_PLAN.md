# Workshop Plan — Stand Out with Workload-Driven Engineering

## Goal
Teach students how to make projects impressive by proving impact (tests, benchmarks, regression infra), not just writing implementation code.

## Format (90 minutes)

### 1) Setup + framing (10 min)
- Why "AI can generate code" means project value shifts to problem framing + measurable impact.
- Baseline claim: "Don't claim a universal winner. Define a workload."

### 2) Level 1 — Correctness first (20 min)
- Students fill a partial map skeleton (`InsertOrAssign`, `FindPtr`).
- Run tests and baseline benchmark command.
- Lesson: No benchmark claims without correctness.

### 3) Level 2 — Generic optimization (20 min)
- Implement power-of-2 sizing and reserve behavior.
- Re-run benchmark and compare percent changes.
- Lesson: data-structure internals matter, but broad wins are still hard.

### 4) Level 3 — Real workload specialization (25 min)
- Scenario: request/batch-scoped dedup + enrichment cache with repeated IDs and large metadata records.
- Use `ScratchIndirectHashMap` benchmark profile.
- Lesson: niche constraints + structural change can beat strong baselines.

### 5) Production thinking (15 min)
- Run AI Work Advisor (deterministic scoring) from the dashboard.
- Run Regression Triage Assistant on baseline/current snapshots.
- Show CI regression guard workflow and thresholds.

## Real-world system references
- Request-scoped dedup service: incoming request with repeated document/user IDs.
- Batch enrichment cache: process records in windows; clear and rebuild map per batch.
- Graph traversal scratch state: visited map rebuilt each query.

## Learning outcomes
- Students can define workload mixes (insert/find/erase/clear) with percentages.
- Students can justify map selection with measurable evidence.
- Students can add production guardrails: monitoring, regression alerts, CI checks.
