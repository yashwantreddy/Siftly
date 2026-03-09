import JSZip from 'jszip'
import prisma from '@/lib/db'

interface BookmarkRow {
  id: string
  tweetId: string
  text: string
  authorHandle: string
  authorName: string
  source: string
  rawJson?: string
  semanticTags?: string | null
  entities?: string | null
  enrichedAt?: Date | null
  enrichmentMeta?: string | null
  tweetCreatedAt: Date | null
  importedAt: Date
  mediaItems: MediaItemRow[]
  categories: CategoryJoin[]
}

interface MediaItemRow {
  id: string
  type: string
  url: string
  thumbnailUrl: string | null
  localPath: string | null
  imageTags?: string | null
}

interface CategoryJoin {
  confidence?: number | null
  category: {
    name: string
    slug: string
    color: string
  }
}

type ParsedEntities = {
  hashtags?: string[]
  urls?: string[]
  mentions?: string[]
  tools?: string[]
  tweetType?: string
}

type ParsedEnrichmentMeta = {
  sentiment?: string
  people?: string[]
  companies?: string[]
}

type ParsedImageTags = {
  people?: string[]
  text_ocr?: string[]
  objects?: string[]
  scene?: string
  action?: string
  mood?: string
  style?: string
  meme_template?: string | null
  tags?: string[]
}

export const MAX_CSV_MEDIA_ITEMS = 4

async function fetchBookmarksFull(where?: object): Promise<BookmarkRow[]> {
  return prisma.bookmark.findMany({
    where,
    include: {
      mediaItems: true,
      categories: {
        include: { category: true },
      },
    },
    orderBy: { importedAt: 'desc' },
  }) as Promise<BookmarkRow[]>
}

function formatCsvField(value: string): string {
  const escaped = value.replace(/"/g, '""')
  return `"${escaped}"`
}

function buildCsvRow(fields: string[]): string {
  return fields.map(formatCsvField).join(',')
}

function safeParseJson<T>(value: string | null | undefined): T | null {
  if (!value || value === '{}' || value === '[]') return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function listToCell(value: string[] | undefined): string {
  return value?.filter(Boolean).join('; ') ?? ''
}

function dateToCell(value: Date | null | undefined): string {
  return value?.toISOString() ?? ''
}

function parseImageTags(value: string | null | undefined): ParsedImageTags | null {
  return safeParseJson<ParsedImageTags>(value)
}

function parseEntities(value: string | null | undefined): ParsedEntities | null {
  return safeParseJson<ParsedEntities>(value)
}

function parseEnrichmentMeta(value: string | null | undefined): ParsedEnrichmentMeta | null {
  return safeParseJson<ParsedEnrichmentMeta>(value)
}

function parseSemanticTags(value: string | null | undefined): string[] {
  return safeParseJson<string[]>(value) ?? []
}

export function serializeBookmarkForJson(bookmark: BookmarkRow) {
  return {
    tweetId: bookmark.tweetId,
    text: bookmark.text,
    authorHandle: bookmark.authorHandle,
    authorName: bookmark.authorName,
    source: bookmark.source,
    tweetCreatedAt: bookmark.tweetCreatedAt?.toISOString() ?? null,
    importedAt: bookmark.importedAt.toISOString(),
    enrichedAt: bookmark.enrichedAt?.toISOString() ?? null,
    rawJson: bookmark.rawJson ?? null,
    semanticTags: parseSemanticTags(bookmark.semanticTags),
    entities: parseEntities(bookmark.entities),
    enrichmentMeta: parseEnrichmentMeta(bookmark.enrichmentMeta),
    categories: bookmark.categories.map((c) => ({
      name: c.category.name,
      slug: c.category.slug,
      color: c.category.color,
      confidence: c.confidence ?? null,
    })),
    mediaItems: bookmark.mediaItems.map((m) => ({
      type: m.type,
      url: m.url,
      thumbnailUrl: m.thumbnailUrl,
      localPath: m.localPath,
      imageTags: parseImageTags(m.imageTags),
    })),
  }
}

export function buildExportCsvHeaders(maxMediaItems = MAX_CSV_MEDIA_ITEMS): string[] {
  const headers = [
    'tweetId',
    'text',
    'authorHandle',
    'authorName',
    'source',
    'tweetCreatedAt',
    'importedAt',
    'enrichedAt',
    'categories',
    'category_slugs',
    'category_confidences',
    'entity_hashtags',
    'entity_urls',
    'entity_mentions',
    'entity_tools',
    'entity_tweet_type',
    'semantic_tags',
    'sentiment',
    'people',
    'companies',
    'mediaUrls',
  ]

  for (let index = 1; index <= maxMediaItems; index++) {
    headers.push(
      `media${index}_type`,
      `media${index}_url`,
      `media${index}_thumbnail_url`,
      `media${index}_local_path`,
      `media${index}_people`,
      `media${index}_text_ocr`,
      `media${index}_objects`,
      `media${index}_scene`,
      `media${index}_action`,
      `media${index}_mood`,
      `media${index}_style`,
      `media${index}_meme_template`,
      `media${index}_tags`,
    )
  }

  headers.push('media_overflow_json')
  return headers
}

export function serializeBookmarkForCsv(
  bookmark: BookmarkRow,
  maxMediaItems = MAX_CSV_MEDIA_ITEMS,
): Record<string, string> {
  const entities = parseEntities(bookmark.entities)
  const enrichment = parseEnrichmentMeta(bookmark.enrichmentMeta)
  const row: Record<string, string> = {
    tweetId: bookmark.tweetId,
    text: bookmark.text,
    authorHandle: bookmark.authorHandle,
    authorName: bookmark.authorName,
    source: bookmark.source,
    tweetCreatedAt: dateToCell(bookmark.tweetCreatedAt),
    importedAt: dateToCell(bookmark.importedAt),
    enrichedAt: dateToCell(bookmark.enrichedAt),
    categories: bookmark.categories.map((c) => c.category.name).join('; '),
    category_slugs: bookmark.categories.map((c) => c.category.slug).join('; '),
    category_confidences: bookmark.categories.map((c) => (c.confidence ?? '').toString()).join('; '),
    entity_hashtags: listToCell(entities?.hashtags),
    entity_urls: listToCell(entities?.urls),
    entity_mentions: listToCell(entities?.mentions),
    entity_tools: listToCell(entities?.tools),
    entity_tweet_type: entities?.tweetType ?? '',
    semantic_tags: listToCell(parseSemanticTags(bookmark.semanticTags)),
    sentiment: enrichment?.sentiment ?? '',
    people: listToCell(enrichment?.people),
    companies: listToCell(enrichment?.companies),
    mediaUrls: bookmark.mediaItems.map((m) => m.url).join('; '),
    media_overflow_json: '',
  }

  const flattenedMedia = bookmark.mediaItems.slice(0, maxMediaItems)
  for (let index = 0; index < maxMediaItems; index++) {
    const media = flattenedMedia[index]
    const tags = parseImageTags(media?.imageTags)
    const prefix = `media${index + 1}`
    row[`${prefix}_type`] = media?.type ?? ''
    row[`${prefix}_url`] = media?.url ?? ''
    row[`${prefix}_thumbnail_url`] = media?.thumbnailUrl ?? ''
    row[`${prefix}_local_path`] = media?.localPath ?? ''
    row[`${prefix}_people`] = listToCell(tags?.people)
    row[`${prefix}_text_ocr`] = listToCell(tags?.text_ocr)
    row[`${prefix}_objects`] = listToCell(tags?.objects)
    row[`${prefix}_scene`] = tags?.scene ?? ''
    row[`${prefix}_action`] = tags?.action ?? ''
    row[`${prefix}_mood`] = tags?.mood ?? ''
    row[`${prefix}_style`] = tags?.style ?? ''
    row[`${prefix}_meme_template`] = tags?.meme_template ?? ''
    row[`${prefix}_tags`] = listToCell(tags?.tags)
  }

  if (bookmark.mediaItems.length > maxMediaItems) {
    row.media_overflow_json = JSON.stringify(
      bookmark.mediaItems.slice(maxMediaItems).map((media) => ({
        type: media.type,
        url: media.url,
        thumbnailUrl: media.thumbnailUrl,
        localPath: media.localPath,
        imageTags: parseImageTags(media.imageTags),
      })),
    )
  }

  return row
}

async function downloadFile(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return null
    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  } catch {
    return null
  }
}

function urlToFilename(url: string, index: number, ext: string): string {
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split('/')
    const last = segments[segments.length - 1]
    if (last && last.includes('.')) return last
  } catch {
    // fall through
  }
  return `media_${index}${ext}`
}

function mediaExtension(type: string, url: string): string {
  if (type === 'video') return '.mp4'
  if (type === 'gif') return '.mp4'
  if (url.endsWith('.jpg') || url.endsWith('.jpeg')) return '.jpg'
  if (url.endsWith('.png')) return '.png'
  if (url.endsWith('.webp')) return '.webp'
  return '.jpg'
}

export async function exportCategoryAsZip(categorySlug: string): Promise<Buffer> {
  const category = await prisma.category.findUnique({
    where: { slug: categorySlug },
  })

  if (!category) {
    throw new Error(`Category not found: ${categorySlug}`)
  }

  const bookmarks = await fetchBookmarksFull({
    categories: {
      some: { category: { slug: categorySlug } },
    },
  })

  const zip = new JSZip()
  const mediaFolder = zip.folder('media')

  const manifestRows: string[] = [
    buildCsvRow(['tweetId', 'text', 'author', 'url', 'categories', 'date']),
  ]

  let mediaIndex = 0
  for (const bookmark of bookmarks) {
    const tweetUrl = `https://twitter.com/${bookmark.authorHandle}/status/${bookmark.tweetId}`
    const categoryNames = bookmark.categories.map((c) => c.category.name).join('; ')
    const dateStr = bookmark.tweetCreatedAt?.toISOString() ?? ''

    manifestRows.push(
      buildCsvRow([
        bookmark.tweetId,
        bookmark.text,
        bookmark.authorHandle,
        tweetUrl,
        categoryNames,
        dateStr,
      ])
    )

    for (const item of bookmark.mediaItems) {
      const ext = mediaExtension(item.type, item.url)
      const filename = urlToFilename(item.url, mediaIndex, ext)
      mediaIndex++

      const fileData = await downloadFile(item.url)
      if (fileData && mediaFolder) {
        mediaFolder.file(filename, fileData)
      }
    }
  }

  zip.file('manifest.csv', manifestRows.join('\n'))

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return buffer
}

export async function exportAllBookmarksCsv(): Promise<string> {
  const bookmarks = await fetchBookmarksFull()

  const headerList = buildExportCsvHeaders()
  const headers = buildCsvRow(headerList)

  const rows = bookmarks.map((bookmark) => {
    const serialized = serializeBookmarkForCsv(bookmark)
    return buildCsvRow(headerList.map((header) => serialized[header] ?? ''))
  })

  return [headers, ...rows].join('\n')
}

export async function exportBookmarksJson(bookmarkIds?: string[]): Promise<string> {
  const where = bookmarkIds && bookmarkIds.length > 0
    ? { id: { in: bookmarkIds } }
    : undefined

  const bookmarks = await fetchBookmarksFull(where)

  const output = bookmarks.map((bookmark) => serializeBookmarkForJson(bookmark))

  return JSON.stringify(output, null, 2)
}
