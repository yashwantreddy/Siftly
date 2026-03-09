import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createOllamaSemanticEnrichmentProvider,
  getSemanticEnrichmentTestPrompt,
  getPipelineAiRequirements,
  parseEnrichmentResponse,
  extractCanonicalEnrichmentJson,
} from '../lib/semantic-enrichment-provider'

test('parseEnrichmentResponse returns canonical enrichment rows', () => {
  const rows = parseEnrichmentResponse(
    '[{"id":"abc","tags":["react hooks","frontend"],"sentiment":"positive","people":["Dan Abramov"],"companies":["React"]}]',
  )

  assert.deepEqual(rows, [{
    id: 'abc',
    tags: ['react hooks', 'frontend'],
    sentiment: 'positive',
    people: ['Dan Abramov'],
    companies: ['React'],
  }])
})

test('extractCanonicalEnrichmentJson rejects missing required fields', () => {
  assert.throws(
    () => extractCanonicalEnrichmentJson('[{"id":"abc","tags":["x"]}]'),
    /missing required enrichment fields/i,
  )
})

test('getSemanticEnrichmentTestPrompt keeps the existing JSON contract', () => {
  const prompt = getSemanticEnrichmentTestPrompt()
  assert.match(prompt, /"sentiment"/)
  assert.match(prompt, /"companies"/)
})

test('createOllamaSemanticEnrichmentProvider parses message.content JSON arrays', async () => {
  const provider = createOllamaSemanticEnrichmentProvider({
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3.5:9b',
    fetchImpl: async () => new Response(JSON.stringify({
      message: {
        content: '[{"id":"abc","tags":["rag"],"sentiment":"neutral","people":[],"companies":["Ollama"]}]',
      },
    }), { status: 200 }),
  })

  const rows = await provider.enrich('[{"id":"abc","text":"hello"}]')
  assert.equal(rows[0]?.id, 'abc')
  assert.deepEqual(rows[0]?.companies, ['Ollama'])
})

test('createOllamaSemanticEnrichmentProvider throws on HTTP config errors', async () => {
  const provider = createOllamaSemanticEnrichmentProvider({
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3.5:9b',
    fetchImpl: async () => new Response(JSON.stringify({ error: 'model not found' }), { status: 404 }),
  })

  await assert.rejects(() => provider.enrich('[{"id":"abc"}]'), /model not found/i)
})

test('pipeline AI requirements allow Ollama preprocessing without Anthropic for enrichment', () => {
  assert.deepEqual(getPipelineAiRequirements('ollama'), {
    needsAnthropicForVision: false,
    needsAnthropicForEnrichment: false,
    needsAnthropicForCategorization: false,
  })
})
