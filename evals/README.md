# Evaluations

Phase 5 adds the retrieval quality gate (ADR-034, ADR-054). Phase 6 adds model comparisons and `policy.yaml`. No model is selected here.

- `retrieval/fixture.jsonl`: a synthetic dataset over the test corpus in `apps/api/src/testing/fixtures/`. CI runs it against fakes to prove the gate itself works.
- `retrieval/golden.jsonl`: the real questions over the real corpus (answerable, off-topic, injection), written with the owner in P5-01. Run it with `eval-candidate`.
- `indexes/<index>.json`: the public manifest of each ingested index (sources, chunk ids, hashes, configuration; no chunk text).
- `reports/<index>-<time>.json`: gate reports (metrics and case ids only; never an answer or a question). `promote` requires a passing, recent one.

See [index-lifecycle.md](../docs/operations/index-lifecycle.md).
