# Ollama Live Stress Harness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an opt-in live stress harness that hits the real Ollama server with concurrent enrichment and categorization requests so we can measure whether local preprocessing actually runs in parallel or stalls.

**Architecture:** Create a reusable stress runner that measures real concurrent request execution and a thin CLI-style test entrypoint that invokes the existing Ollama provider adapters. Keep offline unit tests focused on the runner mechanics, and keep live network execution behind explicit environment flags.

**Tech Stack:** TypeScript, node:test via `tsx`, native `fetch`, existing Ollama provider adapters

---

### Task 1: Lock the stress runner contract with failing tests

**Files:**
- Create: `tests/ollama-stress.test.ts`
- Create: `lib/ollama-stress.ts`
- Test: `tests/ollama-stress.test.ts`

**Step 1: Write the failing test**

Add tests that require a runner to:

- execute all tasks
- respect the concurrency limit
- report `maxInFlight`
- count successes and failures
- time out hung tasks

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/ollama-stress.test.ts`
Expected: FAIL because `lib/ollama-stress.ts` does not exist yet

**Step 3: Write minimal implementation**

Create `lib/ollama-stress.ts` with:

- `runStressSweep()`
- timeout wrapping for each task
- summary stats:
  - `requested`
  - `succeeded`
  - `failed`
  - `wallTimeMs`
  - `maxInFlight`
  - `effectiveParallelism`
  - `durationsMs`

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/ollama-stress.test.ts`
Expected: PASS

### Task 2: Add a live Ollama harness entrypoint

**Files:**
- Create: `tests/ollama-live-stress.test.ts`
- Modify: `package.json`
- Test: `tests/ollama-live-stress.test.ts`

**Step 1: Write the failing test**

Add an opt-in live test that:

- skips unless `OLLAMA_STRESS=1`
- builds a real Ollama provider for enrichment or categorization
- runs sweeps for configured concurrency values
- prints a JSON summary

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/ollama-live-stress.test.ts`
Expected: FAIL until the harness wiring exists

**Step 3: Write minimal implementation**

Implement the live test to:

- parse env vars
- choose stage
- build realistic request payloads
- call `runStressSweep()`
- emit summaries to stdout

Add a convenience script in `package.json`, for example:

```json
"test:ollama-stress": "node --import tsx --test tests/ollama-live-stress.test.ts"
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/ollama-live-stress.test.ts`
Expected: PASS when skipped with no env flag, then execute when enabled

### Task 3: Verify against the real Ollama instance

**Files:**
- None

**Step 1: Run the focused unit tests**

Run: `node --import tsx --test tests/ollama-stress.test.ts`
Expected: PASS

**Step 2: Run the live stress harness**

Run:

```bash
OLLAMA_STRESS=1 \
OLLAMA_STRESS_STAGE=enrichment \
OLLAMA_STRESS_CONCURRENCY=1,2,4,8,20 \
node --import tsx --test tests/ollama-live-stress.test.ts
```

Run again for categorization:

```bash
OLLAMA_STRESS=1 \
OLLAMA_STRESS_STAGE=categorization \
OLLAMA_STRESS_CONCURRENCY=1,2,4,8,20 \
node --import tsx --test tests/ollama-live-stress.test.ts
```

Expected:

- either clear evidence of overlap and successful responses
- or timeout/error behavior that shows Ollama is the bottleneck

**Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS
