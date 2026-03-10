import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCategorizationPrompt,
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

test('extractCanonicalCategorizationJson normalizes a single object response into an array', () => {
  const json = extractCanonicalCategorizationJson('{"tweetId":"1","assignments":[{"category":"ai-resources","confidence":0.92}]}')

  assert.equal(
    json,
    '[{"tweetId":"1","assignments":[{"category":"ai-resources","confidence":0.92}]}]',
  )
})

test('getCategorizationTestPrompt preserves tweetId and assignments schema', () => {
  const prompt = getCategorizationTestPrompt()
  assert.match(prompt, /"tweetId"/)
  assert.match(prompt, /"assignments"/)
})

test('buildCategorizationPrompt emits bookmark payloads with tweetId fields', () => {
  const prompt = buildCategorizationPrompt(
    [{ tweetId: 'tweet-123', text: 'AI agents are useful' }],
    { 'ai-resources': 'AI and ML content' },
    ['ai-resources'],
  )

  assert.match(prompt, /"tweetId": "tweet-123"/)
  assert.doesNotMatch(prompt, /"id": "tweet-123"/)
})

test('parseCategorizationResponse accepts id as a fallback tweet identifier', () => {
  const rows = parseCategorizationResponse(
    '[{"id":"1","assignments":[{"category":"ai-resources","confidence":0.92}]}]',
    new Set(['ai-resources']),
  )

  assert.deepEqual(rows, [{
    tweetId: '1',
    assignments: [{ category: 'ai-resources', confidence: 0.92 }],
  }])
})

test('createOllamaCategorizationProvider parses message.content assignment arrays', async () => {
  const provider = createOllamaCategorizationProvider({
    baseUrl: 'http://127.0.0.1:11434',
    model: 'gemma3:4b',
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
    model: 'gemma3:4b',
    fetchImpl: async () => new Response(JSON.stringify({
      message: { content: '{"not":"an-array"}' },
    }), { status: 200 }),
  })

  await assert.rejects(() => provider.categorize('[]', new Set(['ai-resources'])), /json array/i)
})

test('createOllamaCategorizationProvider accepts a single categorization object response', async () => {
  const provider = createOllamaCategorizationProvider({
    baseUrl: 'http://127.0.0.1:11434',
    model: 'gemma3:4b',
    fetchImpl: async () => new Response(JSON.stringify({
      message: {
        content: '{"tweetId":"1","assignments":[{"category":"ai-resources","confidence":0.92}]}',
      },
    }), { status: 200 }),
  })

  const rows = await provider.categorize('[]', new Set(['ai-resources']))
  assert.equal(rows[0]?.tweetId, '1')
  assert.equal(rows[0]?.assignments[0]?.category, 'ai-resources')
})
