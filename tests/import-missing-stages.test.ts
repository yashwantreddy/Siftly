import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getMissingStagesForBookmark,
  summarizeMissingStages,
} from '../lib/import-missing-stages'

function makeBookmark(overrides: Partial<{
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

test('getMissingStagesForBookmark returns no stages for fully restored bookmarks', () => {
  const stages = getMissingStagesForBookmark(makeBookmark({}))

  assert.deepEqual(stages, [])
})

test('getMissingStagesForBookmark marks missing entities', () => {
  const stages = getMissingStagesForBookmark(makeBookmark({ entities: null }))

  assert.deepEqual(stages, ['entities'])
})

test('getMissingStagesForBookmark marks untagged media as needing vision', () => {
  const stages = getMissingStagesForBookmark(makeBookmark({
    mediaItems: [
      { type: 'photo', imageTags: null },
      { type: 'video', imageTags: '{"scene":"demo"}' },
    ],
  }))

  assert.deepEqual(stages, ['vision'])
})

test('getMissingStagesForBookmark marks incomplete enrichment state', () => {
  const stages = getMissingStagesForBookmark(makeBookmark({
    semanticTags: '["react hooks"]',
    enrichmentMeta: null,
    enrichedAt: null,
  }))

  assert.deepEqual(stages, ['enrichment'])
})

test('getMissingStagesForBookmark marks uncategorized bookmarks', () => {
  const stages = getMissingStagesForBookmark(makeBookmark({ categories: [] }))

  assert.deepEqual(stages, ['categorization'])
})

test('summarizeMissingStages aggregates counts and bookmark ids per stage', () => {
  const summary = summarizeMissingStages([
    makeBookmark({ id: 'bm-entities', entities: null }),
    makeBookmark({ id: 'bm-vision', mediaItems: [{ type: 'photo', imageTags: null }] }),
    makeBookmark({ id: 'bm-enrichment', semanticTags: null }),
    makeBookmark({ id: 'bm-categorization', categories: [] }),
    makeBookmark({ id: 'bm-complete' }),
  ])

  assert.deepEqual(summary, {
    counts: {
      entities: 1,
      vision: 1,
      enrichment: 1,
      categorization: 1,
    },
    bookmarkIds: {
      entities: ['bm-entities'],
      vision: ['bm-vision'],
      enrichment: ['bm-enrichment'],
      categorization: ['bm-categorization'],
    },
  })
})
