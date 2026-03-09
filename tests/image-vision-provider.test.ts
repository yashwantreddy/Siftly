import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_VISION_MODEL,
  parseImageVisionProvider,
  sanitizeOllamaBaseUrl,
  sanitizeOllamaVisionModel,
} from '../lib/image-vision-config'
import {
  extractCanonicalVisionJson,
  getImageVisionTestPrompt,
} from '../lib/image-vision-provider'

test('parseImageVisionProvider defaults to anthropic for missing or invalid values', () => {
  assert.equal(parseImageVisionProvider(undefined), 'anthropic')
  assert.equal(parseImageVisionProvider(null), 'anthropic')
  assert.equal(parseImageVisionProvider('something-else'), 'anthropic')
})

test('parseImageVisionProvider accepts ollama explicitly', () => {
  assert.equal(parseImageVisionProvider('ollama'), 'ollama')
})

test('sanitizeOllamaBaseUrl trims whitespace and falls back to default when empty', () => {
  assert.equal(sanitizeOllamaBaseUrl('  http://localhost:11434/  '), 'http://localhost:11434')
  assert.equal(sanitizeOllamaBaseUrl('   '), DEFAULT_OLLAMA_BASE_URL)
})

test('sanitizeOllamaVisionModel trims whitespace and falls back to default when empty', () => {
  assert.equal(sanitizeOllamaVisionModel(' gemma3:4b '), 'gemma3:4b')
  assert.equal(DEFAULT_OLLAMA_VISION_MODEL, 'gemma3:4b')
  assert.equal(sanitizeOllamaVisionModel(''), DEFAULT_OLLAMA_VISION_MODEL)
})

test('extractCanonicalVisionJson returns the canonical JSON object from fenced output', () => {
  const raw = [
    'Here is the analysis:',
    '```json',
    '{"people":[],"text_ocr":["HELLO"],"objects":["terminal"],"scene":"office","action":"showing screen","mood":"neutral","style":"screenshot","meme_template":null,"tags":["hello world"]}',
    '```',
  ].join('\n')

  const canonical = extractCanonicalVisionJson(raw)
  const parsed = JSON.parse(canonical) as Record<string, unknown>

  assert.deepEqual(Object.keys(parsed), [
    'people',
    'text_ocr',
    'objects',
    'scene',
    'action',
    'mood',
    'style',
    'meme_template',
    'tags',
  ])
  assert.deepEqual(parsed.text_ocr, ['HELLO'])
})

test('extractCanonicalVisionJson rejects JSON that does not match the required schema', () => {
  assert.throws(
    () => extractCanonicalVisionJson('{"tags":["only-tags"]}'),
    /missing required vision fields/i,
  )
})

test('getImageVisionTestPrompt includes the canonical response contract', () => {
  const prompt = getImageVisionTestPrompt()

  assert.match(prompt, /Return ONLY valid JSON/i)
  assert.match(prompt, /"text_ocr"/)
  assert.match(prompt, /"meme_template"/)
})
