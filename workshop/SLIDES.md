# Slide Deck Draft (Google Slides Ready)

## Slide 1 — Title
**How to Stand Out: Workload-Driven C++ Performance Engineering**
- Not "can you code a hashmap"
- Yes "can you prove measurable impact"

## Slide 2 — Problem
- AI can generate implementations quickly.
- Differentiation now comes from:
  - workload modeling
  - fair benchmarking
  - production regression control

## Slide 3 — Project arc
1. Build baseline map
2. Benchmark honestly
3. Specialize for a real workload
4. Add reliability infra

## Slide 4 — Workload definition template
- Key/value shape
- Operation mix (%)
- Map lifetime
- Clear frequency
- Miss/hit ratio
- Repeated-ID rate

## Slide 5 — Level 1 exercise
- Fill in map skeleton
- Run tests
- Run baseline benchmark

## Slide 6 — Level 2 exercise
- Power-of-2 sizing
- Reserve policy
- Compare % deltas

## Slide 7 — Level 3 real scenario
**Request-scoped dedup + enrichment cache**
- repeated IDs
- large metadata values
- clear + rebuild every batch

## Slide 8 — Why specialization wins here
- O(1) generation clear
- compact probe slots (key + index)
- large payloads out-of-line

## Slide 9 — Honest results format
- Win case
- Close case
- Lose case
- Explain *why* each happened

## Slide 10 — AI Work Advisor
- Deterministic input: percentages + value size + lifetime
- Output: recommended map + rationale + confidence

## Slide 11 — Regression Triage Assistant
- Input: baseline/current ops, p99, error rate
- Output: severity + likely causes + immediate actions

## Slide 12 — CI & production thinking
- Benchmark snapshot artifacts
- Threshold-based regression guard
- Alert ownership + triage path

## Slide 13 — Resume framing
- "Built workload-aware C++ benchmarking lab"
- "Implemented deterministic map advisor + regression triage"
- "Added CI benchmark regression guard with thresholds"

## Slide 14 — Closing
- Stop optimizing blindly.
- Define workload.
- Measure impact.
- Guard against regressions.
