type JsonRecord = Record<string, unknown>

export interface RestoredCategory {
  name: string
  slug: string
  color: string
  confidence: number | null
}

export interface RestoredMediaItem {
  type: string
  url: string
  thumbnailUrl: string | null
  localPath: string | null
  imageTags: JsonRecord | null
}

export interface RestoredBookmark {
  tweetId: string
  text: string
  authorHandle: string
  authorName: string
  source: string
  tweetCreatedAt: Date | null
  importedAt: Date
  enrichedAt: Date | null
  rawJson: string | null
  semanticTags: string[]
  entities: JsonRecord | null
  enrichmentMeta: JsonRecord | null
  categories: RestoredCategory[]
  mediaItems: RestoredMediaItem[]
}

interface ExportedBookmarkShape {
  tweetId?: unknown
  text?: unknown
  authorHandle?: unknown
  authorName?: unknown
  source?: unknown
  tweetCreatedAt?: unknown
  importedAt?: unknown
  enrichedAt?: unknown
  rawJson?: unknown
  semanticTags?: unknown
  entities?: unknown
  enrichmentMeta?: unknown
  categories?: unknown
  mediaItems?: unknown
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function getExportedBookmarks(parsed: unknown): ExportedBookmarkShape[] {
  if (Array.isArray(parsed)) return parsed as ExportedBookmarkShape[]

  const record = asRecord(parsed)
  if (record && Array.isArray(record.bookmarks)) {
    return record.bookmarks as ExportedBookmarkShape[]
  }

  return []
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function parseOptionalDate(value: unknown, fieldName: string): Date | null {
  if (value == null) return null
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${fieldName}: expected ISO date string or null`)
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${fieldName}: ${value}`)
  }

  return parsed
}

function parseRequiredDate(value: unknown, fieldName: string): Date {
  const parsed = parseOptionalDate(value, fieldName)
  if (!parsed) {
    throw new Error(`Missing required ${fieldName}`)
  }

  return parsed
}

function parseCategories(value: unknown): RestoredCategory[] {
  if (!Array.isArray(value)) return []

  return value.map((item) => {
    const record = asRecord(item)
    if (!record) throw new Error('Invalid category row in Siftly export')
    if (typeof record.name !== 'string' || typeof record.slug !== 'string' || typeof record.color !== 'string') {
      throw new Error('Invalid category fields in Siftly export')
    }

    return {
      name: record.name,
      slug: record.slug,
      color: record.color,
      confidence: typeof record.confidence === 'number' ? record.confidence : null,
    }
  })
}

function parseMediaItems(value: unknown): RestoredMediaItem[] {
  if (!Array.isArray(value)) return []

  return value.map((item) => {
    const record = asRecord(item)
    if (!record) throw new Error('Invalid media row in Siftly export')
    if (typeof record.type !== 'string' || typeof record.url !== 'string') {
      throw new Error('Invalid media fields in Siftly export')
    }

    return {
      type: record.type,
      url: record.url,
      thumbnailUrl: typeof record.thumbnailUrl === 'string' ? record.thumbnailUrl : null,
      localPath: typeof record.localPath === 'string' ? record.localPath : null,
      imageTags: asRecord(record.imageTags),
    }
  })
}

export function isSiftlyJsonExport(parsed: unknown): boolean {
  const bookmarks = getExportedBookmarks(parsed)
  if (bookmarks.length === 0) return false

  return bookmarks.every((bookmark) => (
    typeof bookmark.tweetId === 'string' &&
    typeof bookmark.text === 'string' &&
    typeof bookmark.authorHandle === 'string' &&
    typeof bookmark.authorName === 'string' &&
    'mediaItems' in bookmark &&
    'categories' in bookmark &&
    'semanticTags' in bookmark
  ))
}

export function normalizeSiftlyImportPayload(parsed: unknown): RestoredBookmark[] {
  if (!isSiftlyJsonExport(parsed)) {
    throw new Error('Unsupported Siftly JSON export format')
  }

  return getExportedBookmarks(parsed).map((bookmark) => {
    if (!isStringArray(bookmark.semanticTags)) {
      throw new Error('Invalid semanticTags in Siftly export')
    }

    if (typeof bookmark.tweetId !== 'string' ||
      typeof bookmark.text !== 'string' ||
      typeof bookmark.authorHandle !== 'string' ||
      typeof bookmark.authorName !== 'string') {
      throw new Error('Missing required bookmark fields in Siftly export')
    }

    return {
      tweetId: bookmark.tweetId,
      text: bookmark.text,
      authorHandle: bookmark.authorHandle,
      authorName: bookmark.authorName,
      source: bookmark.source === 'like' ? 'like' : 'bookmark',
      tweetCreatedAt: parseOptionalDate(bookmark.tweetCreatedAt, 'tweetCreatedAt'),
      importedAt: parseRequiredDate(bookmark.importedAt, 'importedAt'),
      enrichedAt: parseOptionalDate(bookmark.enrichedAt, 'enrichedAt'),
      rawJson: typeof bookmark.rawJson === 'string' ? bookmark.rawJson : null,
      semanticTags: bookmark.semanticTags,
      entities: asRecord(bookmark.entities),
      enrichmentMeta: asRecord(bookmark.enrichmentMeta),
      categories: parseCategories(bookmark.categories),
      mediaItems: parseMediaItems(bookmark.mediaItems),
    }
  })
}
