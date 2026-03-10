import assert from 'node:assert/strict'
import test from 'node:test'

import {
  summarizeMindmapCategorization,
  type MindmapCategorizationBookmark,
} from '../lib/mindmap-categorization-progress'

function bookmark(
  id: string,
  categorized: boolean,
): MindmapCategorizationBookmark {
  return { id, categorized }
}

test('summarizeMindmapCategorization returns stable first bookmark and rest ids', () => {
  const summary = summarizeMindmapCategorization([
    bookmark('bm-001', false),
    bookmark('bm-002', true),
    bookmark('bm-003', false),
    bookmark('bm-004', false),
  ])

  assert.deepEqual(summary, {
    totalBookmarks: 4,
    categorizedCount: 1,
    remainingCount: 3,
    progressPercent: 25,
    firstBookmarkId: 'bm-001',
    firstBookmarkCategorized: false,
    remainingBookmarkIds: ['bm-001', 'bm-003', 'bm-004'],
    restBookmarkIds: ['bm-003', 'bm-004'],
  })
})

test('summarizeMindmapCategorization excludes already categorized bookmarks from remaining ids', () => {
  const summary = summarizeMindmapCategorization([
    bookmark('bm-001', true),
    bookmark('bm-002', true),
    bookmark('bm-003', false),
  ])

  assert.equal(summary.firstBookmarkId, 'bm-001')
  assert.equal(summary.firstBookmarkCategorized, true)
  assert.deepEqual(summary.remainingBookmarkIds, ['bm-003'])
  assert.deepEqual(summary.restBookmarkIds, ['bm-003'])
  assert.equal(summary.categorizedCount, 2)
  assert.equal(summary.remainingCount, 1)
  assert.equal(summary.progressPercent, 67)
})

test('summarizeMindmapCategorization handles empty bookmark lists', () => {
  const summary = summarizeMindmapCategorization([])

  assert.deepEqual(summary, {
    totalBookmarks: 0,
    categorizedCount: 0,
    remainingCount: 0,
    progressPercent: 0,
    firstBookmarkId: null,
    firstBookmarkCategorized: false,
    remainingBookmarkIds: [],
    restBookmarkIds: [],
  })
})
