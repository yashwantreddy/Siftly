import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseStressConfigFromEnv,
  runConfiguredOllamaStress,
} from '../lib/ollama-live-stress'

test('parseStressConfigFromEnv keeps live stress opt-in by default', () => {
  const config = parseStressConfigFromEnv({})
  assert.equal(config.enabled, false)
  assert.deepEqual(config.concurrency, [1, 2, 4, 8, 20])
})

test('parseStressConfigFromEnv accepts vision as a live stress stage', () => {
  const config = parseStressConfigFromEnv({ OLLAMA_STRESS_STAGE: 'vision' })
  assert.equal(config.stage, 'vision')
})

test('configured live stress test runs when enabled or skips otherwise', async (t) => {
  const config = parseStressConfigFromEnv(process.env)
  if (!config.enabled) {
    t.skip('Set OLLAMA_STRESS=1 to run against a real Ollama server.')
    return
  }

  const result = await runConfiguredOllamaStress(config)
  assert.ok(result.length > 0)
})
