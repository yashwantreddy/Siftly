import assert from 'node:assert/strict'
import test from 'node:test'

import type { ParsedBookmark } from '../lib/parser'
import type { RestoredBookmark } from '../lib/import-export-shape'
import {
  importRawBookmarks,
  importRestoredBookmarks,
  type ImportRepository,
} from '../lib/import-service'

function createRepo(initial?: {
  bookmarks?: Array<{
    id: string
    tweetId: string
    text: string
    authorHandle: string
    authorName: string
    source: string
    tweetCreatedAt: Date | null
    importedAt: Date
    rawJson: string | null
    semanticTags: string | null
    entities: string | null
    enrichmentMeta: string | null
    enrichedAt: Date | null
    categories: Array<{ categoryId: string }>
    mediaItems: Array<{ id: string; type: string; url: string; thumbnailUrl: string | null; localPath: string | null; imageTags: string | null }>
  }>
  categoriesBySlug?: Record<string, { id: string; name: string; slug: string; color: string }>
}): ImportRepository & {
  store: {
    bookmarks: Array<{
      id: string
      tweetId: string
      text: string
      authorHandle: string
      authorName: string
      source: string
      tweetCreatedAt: Date | null
      importedAt: Date
      rawJson: string | null
      semanticTags: string | null
      entities: string | null
      enrichmentMeta: string | null
      enrichedAt: Date | null
      categories: Array<{ categoryId: string }>
      mediaItems: Array<{ id: string; type: string; url: string; thumbnailUrl: string | null; localPath: string | null; imageTags: string | null }>
    }>
    categoriesBySlug: Record<string, { id: string; name: string; slug: string; color: string }>
  }
} {
  const store = {
    bookmarks: initial?.bookmarks ? [...initial.bookmarks] : [],
    categoriesBySlug: initial?.categoriesBySlug ? { ...initial.categoriesBySlug } : {},
  }

  return {
    store,
    async findBookmarkByTweetId(tweetId) {
      return store.bookmarks.find((bookmark) => bookmark.tweetId === tweetId) ?? null
    },
    async createRawBookmark(bookmark, source) {
      const id = `bm-${store.bookmarks.length + 1}`
      store.bookmarks.push({
        id,
        tweetId: bookmark.tweetId,
        text: bookmark.text,
        authorHandle: bookmark.authorHandle,
        authorName: bookmark.authorName,
        source,
        tweetCreatedAt: bookmark.tweetCreatedAt,
        importedAt: new Date('2026-03-09T11:00:00.000Z'),
        rawJson: bookmark.rawJson,
        semanticTags: null,
        entities: null,
        enrichmentMeta: null,
        enrichedAt: null,
        categories: [],
        mediaItems: bookmark.media.map((media, index) => ({
          id: `${id}-media-${index + 1}`,
          type: media.type,
          url: media.url,
          thumbnailUrl: media.thumbnailUrl ?? null,
          localPath: null,
          imageTags: null,
        })),
      })
      return { id, created: true }
    },
    async upsertRestoredBookmark(bookmark) {
      const existing = store.bookmarks.find((row) => row.tweetId === bookmark.tweetId)
      if (existing) {
        existing.text = bookmark.text
        existing.authorHandle = bookmark.authorHandle
        existing.authorName = bookmark.authorName
        existing.source = bookmark.source
        existing.tweetCreatedAt = bookmark.tweetCreatedAt
        existing.importedAt = bookmark.importedAt
        existing.rawJson = bookmark.rawJson
        existing.semanticTags = JSON.stringify(bookmark.semanticTags)
        existing.entities = bookmark.entities ? JSON.stringify(bookmark.entities) : null
        existing.enrichmentMeta = bookmark.enrichmentMeta ? JSON.stringify(bookmark.enrichmentMeta) : null
        existing.enrichedAt = bookmark.enrichedAt
        existing.mediaItems = bookmark.mediaItems.map((media, index) => ({
          id: `${existing.id}-media-${index + 1}`,
          type: media.type,
          url: media.url,
          thumbnailUrl: media.thumbnailUrl,
          localPath: media.localPath,
          imageTags: media.imageTags ? JSON.stringify(media.imageTags) : null,
        }))
        existing.categories = bookmark.categories.map((category) => {
          const id = store.categoriesBySlug[category.slug]?.id ?? `${category.slug}-id`
          store.categoriesBySlug[category.slug] = { id, name: category.name, slug: category.slug, color: category.color }
          return { categoryId: id }
        })

        return { id: existing.id, created: false, updated: true }
      }

      const id = `bm-${store.bookmarks.length + 1}`
      store.bookmarks.push({
        id,
        tweetId: bookmark.tweetId,
        text: bookmark.text,
        authorHandle: bookmark.authorHandle,
        authorName: bookmark.authorName,
        source: bookmark.source,
        tweetCreatedAt: bookmark.tweetCreatedAt,
        importedAt: bookmark.importedAt,
        rawJson: bookmark.rawJson,
        semanticTags: JSON.stringify(bookmark.semanticTags),
        entities: bookmark.entities ? JSON.stringify(bookmark.entities) : null,
        enrichmentMeta: bookmark.enrichmentMeta ? JSON.stringify(bookmark.enrichmentMeta) : null,
        enrichedAt: bookmark.enrichedAt,
        categories: bookmark.categories.map((category) => {
          const categoryId = `${category.slug}-id`
          store.categoriesBySlug[category.slug] = {
            id: categoryId,
            name: category.name,
            slug: category.slug,
            color: category.color,
          }
          return { categoryId }
        }),
        mediaItems: bookmark.mediaItems.map((media, index) => ({
          id: `${id}-media-${index + 1}`,
          type: media.type,
          url: media.url,
          thumbnailUrl: media.thumbnailUrl,
          localPath: media.localPath,
          imageTags: media.imageTags ? JSON.stringify(media.imageTags) : null,
        })),
      })

      return { id, created: true, updated: false }
    },
    async getStageRows(bookmarkIds) {
      return store.bookmarks
        .filter((bookmark) => bookmarkIds.includes(bookmark.id))
        .map((bookmark) => ({
          id: bookmark.id,
          entities: bookmark.entities,
          semanticTags: bookmark.semanticTags,
          enrichmentMeta: bookmark.enrichmentMeta,
          enrichedAt: bookmark.enrichedAt,
          categories: bookmark.categories,
          mediaItems: bookmark.mediaItems.map((media) => ({
            type: media.type,
            imageTags: media.imageTags,
          })),
        }))
    },
  }
}

const RAW_BOOKMARK: ParsedBookmark = {
  tweetId: 'raw-1',
  text: 'raw import',
  authorHandle: 'viperr',
  authorName: 'Viperr',
  tweetCreatedAt: new Date('2026-03-08T12:00:00.000Z'),
  hashtags: [],
  urls: [],
  media: [{ type: 'photo', url: 'https://cdn.example.com/raw.png', thumbnailUrl: 'https://cdn.example.com/raw-thumb.png' }],
  rawJson: '{"tweet":"raw"}',
}

const RESTORED_BOOKMARK: RestoredBookmark = {
  tweetId: 'restore-1',
  text: 'restored import',
  authorHandle: 'viperr',
  authorName: 'Viperr',
  source: 'bookmark',
  tweetCreatedAt: new Date('2026-03-08T12:00:00.000Z'),
  importedAt: new Date('2026-03-09T11:00:00.000Z'),
  enrichedAt: new Date('2026-03-09T12:00:00.000Z'),
  rawJson: '{"tweet":"restored"}',
  semanticTags: ['react hooks'],
  entities: { hashtags: ['ai'] },
  enrichmentMeta: { sentiment: 'positive' },
  categories: [{ name: 'AI Resources', slug: 'ai-resources', color: '#fff', confidence: 0.9 }],
  mediaItems: [{ type: 'photo', url: 'https://cdn.example.com/restore.png', thumbnailUrl: null, localPath: null, imageTags: { scene: 'desk' } }],
}

test('importRawBookmarks preserves raw behavior and skips duplicates', async () => {
  const repo = createRepo()

  const first = await importRawBookmarks({
    bookmarks: [RAW_BOOKMARK],
    source: 'bookmark',
    repository: repo,
  })
  const second = await importRawBookmarks({
    bookmarks: [RAW_BOOKMARK],
    source: 'bookmark',
    repository: repo,
  })

  assert.equal(first.imported, 1)
  assert.equal(first.skipped, 0)
  assert.equal(second.imported, 0)
  assert.equal(second.skipped, 1)
})

test('importRestoredBookmarks restores canonical preprocessing state', async () => {
  const repo = createRepo()

  const result = await importRestoredBookmarks({
    bookmarks: [RESTORED_BOOKMARK],
    repository: repo,
  })

  assert.equal(result.imported, 1)
  assert.equal(result.updated, 0)
  assert.equal(result.total, 1)
  assert.deepEqual(result.missing, {
    entities: 0,
    vision: 0,
    enrichment: 0,
    categorization: 0,
  })
})

test('importRestoredBookmarks overwrites existing bookmarks and reports missing stages', async () => {
  const repo = createRepo({
    bookmarks: [{
      id: 'bm-1',
      tweetId: 'restore-1',
      text: 'old text',
      authorHandle: 'old-handle',
      authorName: 'Old',
      source: 'bookmark',
      tweetCreatedAt: null,
      importedAt: new Date('2026-03-01T11:00:00.000Z'),
      rawJson: '{"tweet":"old"}',
      semanticTags: '["old"]',
      entities: '{"hashtags":["old"]}',
      enrichmentMeta: '{"sentiment":"neutral"}',
      enrichedAt: new Date('2026-03-01T12:00:00.000Z'),
      categories: [{ categoryId: 'old-category' }],
      mediaItems: [{ id: 'media-1', type: 'photo', url: 'https://cdn.example.com/old.png', thumbnailUrl: null, localPath: null, imageTags: '{"scene":"old"}' }],
    }],
  })

  const result = await importRestoredBookmarks({
    bookmarks: [{
      ...RESTORED_BOOKMARK,
      semanticTags: [],
      enrichmentMeta: null,
      enrichedAt: null,
      categories: [],
      mediaItems: [{ type: 'photo', url: 'https://cdn.example.com/restore.png', thumbnailUrl: null, localPath: null, imageTags: null }],
    }],
    repository: repo,
  })

  assert.equal(result.imported, 0)
  assert.equal(result.updated, 1)
  assert.deepEqual(result.importedBookmarkIds, ['bm-1'])
  assert.deepEqual(result.missing, {
    entities: 0,
    vision: 1,
    enrichment: 1,
    categorization: 1,
  })
  assert.equal(repo.store.bookmarks[0]?.text, 'restored import')
  assert.equal(repo.store.bookmarks[0]?.authorHandle, 'viperr')
  assert.equal(repo.store.bookmarks[0]?.semanticTags, '[]')
  assert.equal(repo.store.bookmarks[0]?.categories.length, 0)
})
