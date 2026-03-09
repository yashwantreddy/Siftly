import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCategorizeStageSelection,
  getBookmarkStageWork,
  parseCategorizeRequestBody,
} from '../lib/categorize-scope'

function makeRow(overrides: Partial<{
  id: string
  entities: string | null
  semanticTags: string | null
  enrichmentMeta: string | null
  enrichedAt: Date | null
  categories: Array<{ categoryId: string }>
  mediaItems: Array<{ type: string; imageTags: string | null }>
}>) {
  return {
    id: 'bm-1',
    entities: '{"hashtags":["ai"]}',
    semanticTags: '["react hooks"]',
    enrichmentMeta: '{"sentiment":"positive"}',
    enrichedAt: new Date('2026-03-09T12:00:00.000Z'),
    categories: [{ categoryId: 'cat-1' }],
    mediaItems: [{ type: 'photo', imageTags: '{"scene":"desk"}' }],
    ...overrides,
  }
}

test('parseCategorizeRequestBody defaults to all stages and no scope', () => {
  const parsed = parseCategorizeRequestBody('')

  assert.deepEqual(parsed, {
    bookmarkIds: [],
    apiKey: undefined,
    force: false,
    stages: undefined,
  })
})

test('buildCategorizeStageSelection keeps only requested stages when not forced', () => {
  const selection = buildCategorizeStageSelection(['entities', 'vision'], false)

  assert.deepEqual(selection, {
    entities: true,
    vision: true,
    enrichment: false,
    categorize: false,
  })
})

test('buildCategorizeStageSelection enables every stage when forced', () => {
  const selection = buildCategorizeStageSelection(['entities'], true)

  assert.deepEqual(selection, {
    entities: true,
    vision: true,
    enrichment: true,
    categorize: true,
  })
})

test('getBookmarkStageWork skips categorization for already categorized bookmarks', () => {
  const selection = buildCategorizeStageSelection(['categorize'], false)
  const work = getBookmarkStageWork(makeRow({}), selection, false)

  assert.deepEqual(work, {
    vision: false,
    enrichment: false,
    categorize: false,
  })
})

test('getBookmarkStageWork keeps requested missing stages for partial bookmarks', () => {
  const selection = buildCategorizeStageSelection(['vision', 'categorize'], false)
  const work = getBookmarkStageWork(makeRow({
    categories: [],
    mediaItems: [{ type: 'photo', imageTags: null }],
  }), selection, false)

  assert.deepEqual(work, {
    vision: true,
    enrichment: false,
    categorize: true,
  })
})
