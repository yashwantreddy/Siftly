# Ollama Live Stress Harness Design

## Goal

Add a dedicated live stress harness that sends real concurrent requests to the configured Ollama instance so we can determine whether Ollama is actually processing work under the same parallel conditions the bookmark pipeline uses.

## Decisions

- Keep the existing unit tests deterministic and offline.
- Add a separate opt-in live stress path instead of baking networked load tests into the default suite.
- Target the two text-only preprocessing stages first:
  - semantic enrichment
  - categorization
- Reuse the existing Ollama provider adapters so the stress harness exercises the same HTTP payload shape used by the app.
- Report concurrency evidence, not just pass/fail:
  - total wall time
  - per-request latency
  - success/error counts
  - observed max in-flight requests
  - effective parallelism estimate
- Fail hard on timeouts so hangs are visible.

## Runtime Design

Introduce a small stress utility module that:

- accepts a provider runner function
- schedules N real concurrent tasks
- tracks:
  - request start time
  - request end time
  - in-flight count
  - result status
- computes a summary after each sweep

Add a live test entrypoint that:

- reads environment variables for:
  - `OLLAMA_STRESS_BASE_URL`
  - `OLLAMA_STRESS_MODEL`
  - `OLLAMA_STRESS_CONCURRENCY`
  - `OLLAMA_STRESS_TIMEOUT_MS`
  - `OLLAMA_STRESS_STAGE`
- defaults to local Ollama settings when possible
- skips cleanly unless explicitly enabled
- runs one or more sweeps against:
  - `createOllamaSemanticEnrichmentProvider()`
  - `createOllamaCategorizationProvider()`

The harness should print a compact JSON summary so the result is easy to compare across runs.

## What This Will Tell Us

- If Ollama is handling multiple requests at once, wall time should grow sublinearly with request count and max in-flight should exceed 1.
- If Ollama is serializing all work internally, wall time will approximate the sum of request durations and effective parallelism will stay near 1.
- If Ollama stalls under load, timeout failures and long-tail latencies will show it.
- If malformed outputs appear only under concurrency, the harness will surface response-shape failures separately from transport failures.

## Non-Goals

- Do not yet drive the full `/api/categorize` route end to end.
- Do not change pipeline concurrency limits as part of this work.
- Do not add CI coverage for the live harness.

## Verification

- Add unit tests for the stress utility math and timeout handling.
- Run the unit tests directly with `node --import tsx --test`.
- Run the live harness against the local Ollama endpoint with:
  - semantic enrichment
  - categorization
  - a sweep that includes 20 workers
- Run `npx tsc --noEmit` after implementation.
