import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatImportResultSummary,
  getImportFollowupState,
} from '../lib/import-ui-state'

test('formatImportResultSummary mentions updated rows when present', () => {
  const summary = formatImportResultSummary({
    imported: 5,
    updated: 2,
    skipped: 1,
    total: 8,
  })

  assert.equal(summary, '5 imported, 2 updated, 1 skipped')
})

test('getImportFollowupState returns complete mode when nothing is missing', () => {
  const state = getImportFollowupState({
    imported: 5,
    updated: 2,
    skipped: 0,
    total: 7,
    importedBookmarkIds: ['bm-1', 'bm-2'],
    missing: {
      entities: 0,
      vision: 0,
      enrichment: 0,
      categorization: 0,
    },
  })

  assert.deepEqual(state, {
    mode: 'complete',
    primaryLabel: 'View imported bookmarks',
    shouldAutoStart: false,
    missingItems: [],
    hasImportedScope: true,
  })
})

test('getImportFollowupState returns process-missing mode for partial restore imports', () => {
  const state = getImportFollowupState({
    imported: 1,
    updated: 1,
    skipped: 0,
    total: 2,
    importedBookmarkIds: ['bm-1', 'bm-2'],
    missing: {
      entities: 2,
      vision: 1,
      enrichment: 0,
      categorization: 1,
    },
  })

  assert.deepEqual(state, {
    mode: 'process-missing',
    primaryLabel: 'Process missing data',
    shouldAutoStart: false,
    missingItems: ['2 need entities', '1 needs image analysis', '1 needs categorization'],
    hasImportedScope: true,
  })
})

test('getImportFollowupState falls back to process-all for legacy import results', () => {
  const state = getImportFollowupState({
    imported: 3,
    updated: 0,
    skipped: 0,
    total: 3,
  })

  assert.deepEqual(state, {
    mode: 'process-all',
    primaryLabel: 'Start preprocessing',
    shouldAutoStart: true,
    missingItems: [],
    hasImportedScope: false,
  })
})
