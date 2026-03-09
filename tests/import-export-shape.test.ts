import assert from 'node:assert/strict'
import test from 'node:test'

import { serializeBookmarkForJson } from '../lib/exporter'
import {
  isSiftlyJsonExport,
  normalizeSiftlyImportPayload,
} from '../lib/import-export-shape'

const SAMPLE_BOOKMARK = {
  id: 'bm-restore-1',
  tweetId: '123',
  text: 'Restore my preprocessing state',
  authorHandle: 'viperr',
  authorName: 'Viperr',
  source: 'bookmark',
  rawJson: '{"tweet":"raw"}',
  semanticTags: '["react hooks","sqlite"]',
  entities: JSON.stringify({
    hashtags: ['ai'],
    urls: ['https://example.com'],
    mentions: ['viperr'],
    tools: ['Next.js'],
    tweetType: 'thread',
  }),
  enrichedAt: new Date('2026-03-09T12:00:00.000Z'),
  enrichmentMeta: JSON.stringify({
    sentiment: 'positive',
    people: ['Ada Lovelace'],
    companies: ['OpenAI'],
  }),
  tweetCreatedAt: new Date('2026-03-08T12:00:00.000Z'),
  importedAt: new Date('2026-03-09T11:00:00.000Z'),
  mediaItems: [
    {
      id: 'media-1',
      type: 'photo',
      url: 'https://cdn.example.com/1.png',
      thumbnailUrl: 'https://cdn.example.com/1-thumb.png',
      localPath: '/tmp/1.png',
      imageTags: JSON.stringify({
        scene: 'office desk',
        tags: ['terminal', 'react'],
      }),
    },
  ],
  categories: [
    {
      confidence: 0.92,
      category: { name: 'AI Resources', slug: 'ai-resources', color: '#ffffff' },
    },
  ],
}

test('isSiftlyJsonExport recognizes exported bookmark arrays', () => {
  const payload = [serializeBookmarkForJson(SAMPLE_BOOKMARK)]

  assert.equal(isSiftlyJsonExport(payload), true)
})

test('isSiftlyJsonExport rejects raw bookmarklet exports', () => {
  const payload = {
    bookmarks: [
      {
        id: '123',
        author: 'Viperr',
        handle: '@viperr',
        timestamp: '2026-03-09T12:00:00.000Z',
        text: 'raw bookmarklet export',
        media: [],
        hashtags: [],
        urls: [],
      },
    ],
    source: 'bookmark',
  }

  assert.equal(isSiftlyJsonExport(payload), false)
})

test('normalizeSiftlyImportPayload parses restore fields into canonical rows', () => {
  const payload = [serializeBookmarkForJson(SAMPLE_BOOKMARK)]

  const [row] = normalizeSiftlyImportPayload(payload)

  assert.equal(row?.tweetId, '123')
  assert.equal(row?.source, 'bookmark')
  assert.equal(row?.tweetCreatedAt?.toISOString(), '2026-03-08T12:00:00.000Z')
  assert.equal(row?.importedAt.toISOString(), '2026-03-09T11:00:00.000Z')
  assert.equal(row?.enrichedAt?.toISOString(), '2026-03-09T12:00:00.000Z')
  assert.deepEqual(row?.semanticTags, ['react hooks', 'sqlite'])
  assert.deepEqual(row?.entities, {
    hashtags: ['ai'],
    urls: ['https://example.com'],
    mentions: ['viperr'],
    tools: ['Next.js'],
    tweetType: 'thread',
  })
  assert.deepEqual(row?.enrichmentMeta, {
    sentiment: 'positive',
    people: ['Ada Lovelace'],
    companies: ['OpenAI'],
  })
  assert.deepEqual(row?.categories, [
    {
      name: 'AI Resources',
      slug: 'ai-resources',
      color: '#ffffff',
      confidence: 0.92,
    },
  ])
  assert.deepEqual(row?.mediaItems, [
    {
      type: 'photo',
      url: 'https://cdn.example.com/1.png',
      thumbnailUrl: 'https://cdn.example.com/1-thumb.png',
      localPath: '/tmp/1.png',
      imageTags: {
        scene: 'office desk',
        tags: ['terminal', 'react'],
      },
    },
  ])
})
