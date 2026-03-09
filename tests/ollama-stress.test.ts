import assert from 'node:assert/strict'
import test from 'node:test'

import { runStressSweep } from '../lib/ollama-stress'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('runStressSweep executes all tasks and respects the concurrency limit', async () => {
  let inFlight = 0
  let observedMaxInFlight = 0

  const summary = await runStressSweep({
    concurrency: 2,
    count: 5,
    timeoutMs: 500,
    runTask: async (index) => {
      assert.equal(typeof index, 'number')
      inFlight++
      observedMaxInFlight = Math.max(observedMaxInFlight, inFlight)
      await sleep(20)
      inFlight--
    },
  })

  assert.equal(summary.requested, 5)
  assert.equal(summary.succeeded, 5)
  assert.equal(summary.failed, 0)
  assert.equal(summary.durationsMs.length, 5)
  assert.equal(summary.maxInFlight, 2)
  assert.equal(observedMaxInFlight, 2)
  assert.ok(summary.wallTimeMs >= 40)
  assert.ok(summary.effectiveParallelism > 1)
})

test('runStressSweep records failures and preserves completed durations', async () => {
  const summary = await runStressSweep({
    concurrency: 3,
    count: 4,
    timeoutMs: 500,
    runTask: async (index) => {
      if (index === 1 || index === 3) {
        throw new Error(`boom-${index}`)
      }
      await sleep(10)
    },
  })

  assert.equal(summary.requested, 4)
  assert.equal(summary.succeeded, 2)
  assert.equal(summary.failed, 2)
  assert.equal(summary.errors.length, 2)
  assert.match(summary.errors[0] ?? '', /boom-/)
  assert.equal(summary.durationsMs.length, 4)
})

test('runStressSweep times out hung tasks', async () => {
  const summary = await runStressSweep({
    concurrency: 1,
    count: 1,
    timeoutMs: 25,
    runTask: async () => {
      await sleep(100)
    },
  })

  assert.equal(summary.requested, 1)
  assert.equal(summary.succeeded, 0)
  assert.equal(summary.failed, 1)
  assert.match(summary.errors[0] ?? '', /timed out/i)
  assert.ok(summary.wallTimeMs >= 25)
  assert.ok(summary.wallTimeMs < 100)
})
