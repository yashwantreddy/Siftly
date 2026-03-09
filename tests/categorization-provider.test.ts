import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createOllamaCategorizationProvider,
  extractCanonicalCategorizationJson,
  getCategorizationTestPrompt,
  parseCategorizationResponse,
} from '../lib/categorization-provider'

test('parseCategorizationResponse keeps valid slugs and clamps confidence', () => {
  const rows = parseCategorizationResponse(
    '[{"tweetId":"1","assignments":[{"category":"ai-resources","confidence":1.5},{"category":"unknown","confidence":0.8}]}]',
    new Set(['ai-resources']),
  )

  assert.deepEqual(rows, [{
    tweetId: '1',
    assignments: [{ category: 'ai-resources', confidence: 1 }],
  }])
})

test('extractCanonicalCategorizationJson rejects missing assignments', () => {
  assert.throws(
    () => extractCanonicalCategorizationJson('[{"tweetId":"1"}]'),
    /missing required categorization fields/i,
  )
})

test('getCategorizationTestPrompt preserves tweetId and assignments schema', () => {
  const prompt = getCategorizationTestPrompt()
  assert.match(prompt, /"tweetId"/)
  assert.match(prompt, /"assignments"/)
})

test('createOllamaCategorizationProvider parses message.content assignment arrays', async () => {
  const provider = createOllamaCategorizationProvider({
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3.5:9b',
    fetchImpl: async () => new Response(JSON.stringify({
      message: {
        content: '[{"tweetId":"1","assignments":[{"category":"ai-resources","confidence":0.92}]}]',
      },
    }), { status: 200 }),
  })

  const rows = await provider.categorize('[]', new Set(['ai-resources']))
  assert.equal(rows[0]?.tweetId, '1')
  assert.equal(rows[0]?.assignments[0]?.category, 'ai-resources')
})

test('createOllamaCategorizationProvider throws on malformed JSON', async () => {
  const provider = createOllamaCategorizationProvider({
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3.5:9b',
    fetchImpl: async () => new Response(JSON.stringify({
      message: { content: '{"not":"an-array"}' },
    }), { status: 200 }),
  })

  await assert.rejects(() => provider.categorize('[]', new Set(['ai-resources'])), /json array/i)
})
