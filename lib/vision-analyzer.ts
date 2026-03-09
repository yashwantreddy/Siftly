import Anthropic from '@anthropic-ai/sdk'
import prisma from '@/lib/db'
import { getCliAvailability, claudePrompt, modelNameToCliAlias } from '@/lib/claude-cli-auth'
import {
  createAnthropicImageVisionProvider,
  createOllamaImageVisionProvider,
  ImageVisionProviderError,
  type AllowedMediaType,
} from '@/lib/image-vision-provider'
import {
  getAnthropicModel,
  getImageVisionProvider,
  getOllamaBaseUrl,
  getOllamaVisionModel,
} from '@/lib/settings'
import {
  buildSemanticEnrichmentItems,
  BookmarkForEnrichment,
  createAnthropicSemanticEnrichmentProvider,
  createOllamaSemanticEnrichmentProvider,
  EnrichmentResult,
  getSemanticEnrichmentPrompt,
  parseEnrichmentResponse,
} from '@/lib/semantic-enrichment-provider'

export { getAnthropicModel, getImageVisionProvider, getOllamaBaseUrl, getOllamaVisionModel } from '@/lib/settings'
export type { BookmarkForEnrichment, EnrichmentResult } from '@/lib/semantic-enrichment-provider'

function guessMediaType(url: string, contentTypeHeader: string | null): AllowedMediaType {
  const ct = contentTypeHeader?.toLowerCase() ?? ''
  if (ct.includes('png') || url.includes('.png')) return 'image/png'
  if (ct.includes('gif') || url.includes('.gif')) return 'image/gif'
  if (ct.includes('webp') || url.includes('.webp')) return 'image/webp'
  return 'image/jpeg'
}

const MAX_IMAGE_BYTES = 3_500_000 // 3.5MB raw → ~4.7MB base64, under Claude's 5MB limit

async function fetchImageAsBase64(
  url: string,
): Promise<{ data: string; mediaType: AllowedMediaType } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Referer: 'https://twitter.com/',
      },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    const buffer = await res.arrayBuffer()
    if (buffer.byteLength < 500) return null // skip tiny/broken responses
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      console.warn(`[vision] skipping oversized image (${Math.round(buffer.byteLength / 1024)}KB): ${url.slice(0, 80)}`)
      return null
    }
    const mediaType = guessMediaType(url, res.headers.get('content-type'))
    return { data: Buffer.from(buffer).toString('base64'), mediaType }
  } catch {
    return null
  }
}

const RETRY_DELAYS_MS = [1500, 4000, 10000]
const CONCURRENCY = 12

async function analyzeImageWithRetry(
  url: string,
  client: Anthropic | null,
  model: string,
  attempt = 0,
): Promise<string> {
  const img = await fetchImageAsBase64(url)
  if (!img) return ''

  const visionProvider = await getImageVisionProvider()

  try {
    if (visionProvider === 'ollama') {
      const ollamaProvider = createOllamaImageVisionProvider({
        baseUrl: await getOllamaBaseUrl(),
        model: await getOllamaVisionModel(),
      })
      return await ollamaProvider.analyze(img)
    }

    if (!client) {
      throw new ImageVisionProviderError('No Anthropic client available for image analysis.', {
        code: 'config',
        provider: 'anthropic',
      })
    }

    return await createAnthropicImageVisionProvider({ client, model }).analyze(img)
  } catch (err) {
    if (err instanceof ImageVisionProviderError && err.provider === 'ollama') {
      throw err
    }

    const msg = err instanceof Error ? err.message : String(err)
    // Never retry client errors (4xx) — bad request, invalid image, too large, etc.
    const isClientError = msg.includes('400') || msg.includes('401') || msg.includes('403') || msg.includes('422')
    const isRetryable =
      !isClientError && (
        msg.includes('rate') ||
        msg.includes('529') ||
        msg.includes('overloaded') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('fetch') ||
        msg.includes('network') ||
        msg.includes('500') ||
        msg.includes('502') ||
        msg.includes('503')
      )

    if (attempt === 0) {
      // Log first failure per item so server console shows what's wrong
      console.warn(`[vision] analysis failed (attempt ${attempt + 1}): ${msg.slice(0, 120)}`)
    }

    if (isRetryable && attempt < RETRY_DELAYS_MS.length) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]))
      return analyzeImageWithRetry(url, client, model, attempt + 1)
    }
    return ''
  }
}

export interface MediaItemForAnalysis {
  id: string
  url: string
  thumbnailUrl: string | null
  type: string
}

/**
 * Check if this URL's analysis result is already cached in another MediaItem row.
 * Deduplicates API calls for the same image URL.
 */
async function getCachedAnalysis(imageUrl: string, excludeId: string): Promise<string | null> {
  const existing = await prisma.mediaItem.findFirst({
    where: { url: imageUrl, imageTags: { not: null }, id: { not: excludeId } },
    select: { imageTags: true },
  })
  return existing?.imageTags ?? null
}

export async function analyzeItem(
  item: MediaItemForAnalysis,
  client: Anthropic | null,
  model: string,
): Promise<number> {
  const imageUrl = item.type === 'video' ? (item.thumbnailUrl ?? item.url) : item.url

  // Check URL-level dedup cache first
  const cached = await getCachedAnalysis(imageUrl, item.id)
  if (cached) {
    await prisma.mediaItem.update({ where: { id: item.id }, data: { imageTags: cached } })
    return 1
  }

  const prefix = item.type === 'video' ? '{"_type":"video_thumbnail",' : ''
  let tags = ''
  try {
    tags = await analyzeImageWithRetry(imageUrl, client, model)
  } catch (err) {
    await prisma.mediaItem.update({ where: { id: item.id }, data: { imageTags: '{}' } })
    throw err
  }

  if (tags && prefix) {
    // Inject a _type marker into the JSON for video thumbnails
    tags = tags.replace(/^\{/, prefix)
  }

  if (tags) {
    await prisma.mediaItem.update({ where: { id: item.id }, data: { imageTags: tags } })
    return 1
  }

  // CRITICAL: Mark as attempted even on failure. Without this, the while loop in
  // analyzeAllUntagged re-fetches the same items forever (infinite loop).
  await prisma.mediaItem.update({ where: { id: item.id }, data: { imageTags: '{}' } })
  return 0
}

export async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = []
  let index = 0

  async function worker() {
    while (index < tasks.length) {
      const taskIndex = index++
      results[taskIndex] = await tasks[taskIndex]()
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker())
  await Promise.all(workers)
  return results
}

export async function analyzeBatch(
  items: MediaItemForAnalysis[],
  client: Anthropic | null,
  onProgress?: (delta: number) => void,
  shouldAbort?: () => boolean,
): Promise<number> {
  const analyzable = items.filter((m) => m.type === 'photo' || m.type === 'gif' || m.type === 'video')
  if (analyzable.length === 0) return 0

  const model = await getAnthropicModel()

  const tasks = analyzable.map((item) => async () => {
    if (shouldAbort?.()) return 0
    const result = await analyzeItem(item, client, model)
    onProgress?.(1)
    return result
  })
  const results = await runWithConcurrency(tasks, CONCURRENCY)

  return results.reduce((sum, r) => sum + r, 0)
}

export async function analyzeUntaggedImages(client: Anthropic | null, limit = 10): Promise<number> {
  const untagged = await prisma.mediaItem.findMany({
    where: { imageTags: null, type: { in: ['photo', 'gif', 'video'] } },
    take: limit,
    select: { id: true, url: true, thumbnailUrl: true, type: true },
  })
  if (untagged.length === 0) return 0
  return analyzeBatch(untagged, client)
}

/**
 * Analyze ALL untagged media items (no limit). Used during full AI categorization.
 */
export async function analyzeAllUntagged(
  client: Anthropic | null,
  onProgress?: (total: number) => void,
  shouldAbort?: () => boolean,
): Promise<number> {
  const CHUNK = 15
  let total = 0
  let cursor: string | undefined

  while (true) {
    if (shouldAbort?.()) break

    // Use cursor-based pagination so failed items (marked '{}') are skipped naturally,
    // and we never re-fetch items we already attempted this run.
    const untagged = await prisma.mediaItem.findMany({
      where: {
        type: { in: ['photo', 'gif', 'video'] },
        // Only fetch items that have never been attempted (null) — '{}' sentinel means already tried
        imageTags: null,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: CHUNK,
      select: { id: true, url: true, thumbnailUrl: true, type: true },
    })

    if (untagged.length === 0) break

    cursor = untagged[untagged.length - 1].id

    await analyzeBatch(untagged, client, (delta) => {
      total += delta
      onProgress?.(total)
    }, shouldAbort)

    if (untagged.length < CHUNK) break
  }

  return total
}

// ── Batch semantic enrichment ──────────────────────────────────────────────────

const ENRICH_BATCH_SIZE = 5
const ENRICH_CONCURRENCY = 2

export async function enrichBatchSemanticTags(
  bookmarks: BookmarkForEnrichment[],
  client: Anthropic | null,
): Promise<EnrichmentResult[]> {
  if (bookmarks.length === 0) return []

  const bookmarksJson = buildSemanticEnrichmentItems(bookmarks)
  const provider = await getImageVisionProvider()

  if (provider === 'ollama') {
    const ollamaProvider = createOllamaSemanticEnrichmentProvider({
      baseUrl: await getOllamaBaseUrl(),
      model: await getOllamaVisionModel(),
    })
    return ollamaProvider.enrich(bookmarksJson)
  }

  // Prefer CLI over SDK
  if (await getCliAvailability()) {
    const modelSetting = await getAnthropicModel()
    const cliModel = modelNameToCliAlias(modelSetting)

    const result = await claudePrompt(getSemanticEnrichmentPrompt(bookmarksJson), { model: cliModel, timeoutMs: 90_000 })
    if (result.success && result.data) {
      try {
        return parseEnrichmentResponse(result.data)
      } catch {
        console.warn('[enrich] CLI response parse failed, falling back to SDK')
      }
    }
  }

  // Fallback to SDK
  if (!client) {
    console.warn('[enrich] CLI not available and no API client')
    return []
  }

  const model = await getAnthropicModel()
  const ENRICH_RETRY_DELAYS = [2000, 5000]

  for (let attempt = 0; attempt <= ENRICH_RETRY_DELAYS.length; attempt++) {
    try {
      const results = await createAnthropicSemanticEnrichmentProvider({ client, model }).enrich(bookmarksJson)
      if (results.length > 0) return results
      console.warn(`[enrich] no JSON array in response (attempt ${attempt + 1})`)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.warn(`[enrich] batch failed (attempt ${attempt + 1}): ${errMsg.slice(0, 120)}`)
      const isClientError = errMsg.includes('400') || errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('422')
      if (isClientError || attempt >= ENRICH_RETRY_DELAYS.length) break
      await new Promise((r) => setTimeout(r, ENRICH_RETRY_DELAYS[attempt]))
    }
  }
  return []
}

/**
 * Run semantic enrichment for all bookmarks that have no semanticTags yet.
 * Processes bookmarks in batches of ENRICH_BATCH_SIZE (one API call per batch)
 * with ENRICH_CONCURRENCY parallel batches — 5-10x fewer API calls vs. per-bookmark.
 */
export async function enrichAllBookmarks(
  client: Anthropic,
  onProgress?: (total: number) => void,
  shouldAbort?: () => boolean,
): Promise<number> {
  const CHUNK = ENRICH_BATCH_SIZE * ENRICH_CONCURRENCY * 2 // fetch ahead of processing
  let enriched = 0
  let cursor: string | undefined

  while (true) {
    if (shouldAbort?.()) break

    const rows = await prisma.bookmark.findMany({
      where: {
        semanticTags: null,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: CHUNK,
      select: {
        id: true,
        text: true,
        entities: true,
        mediaItems: { select: { imageTags: true } },
      },
    })

    if (rows.length === 0) break
    cursor = rows[rows.length - 1].id

    // Separate bookmarks worth enriching from trivial ones (mark trivial immediately)
    const trivialIds: string[] = []
    const toEnrich: BookmarkForEnrichment[] = []

    for (const b of rows) {
      const imageTags = b.mediaItems
        .map((m) => m.imageTags)
        .filter((t): t is string => t !== null && t !== '' && t !== '{}')

      if (imageTags.length === 0 && b.text.length < 20) {
        trivialIds.push(b.id)
        continue
      }

      let entities: BookmarkForEnrichment['entities'] = undefined
      if (b.entities) {
        try { entities = JSON.parse(b.entities) as typeof entities } catch { /* ignore */ }
      }

      toEnrich.push({ id: b.id, text: b.text, imageTags, entities })
    }

    // Mark trivial bookmarks in one batch
    if (trivialIds.length > 0) {
      await prisma.bookmark.updateMany({
        where: { id: { in: trivialIds } },
        data: { semanticTags: '[]' },
      })
    }

    // Split into batches and process with concurrency
    const batches: BookmarkForEnrichment[][] = []
    for (let i = 0; i < toEnrich.length; i += ENRICH_BATCH_SIZE) {
      batches.push(toEnrich.slice(i, i + ENRICH_BATCH_SIZE))
    }

    const batchTasks = batches.map((batch) => async () => {
      if (shouldAbort?.()) return

      const results = await enrichBatchSemanticTags(batch, client)
      const resultMap = new Map(results.map((r) => [r.id, r]))

      for (const b of batch) {
        const result = resultMap.get(b.id)
        if (result?.tags.length) {
          await prisma.bookmark.update({
            where: { id: b.id },
            data: {
              semanticTags: JSON.stringify(result.tags),
              enrichmentMeta: JSON.stringify({
                sentiment: result.sentiment,
                people: result.people,
                companies: result.companies,
              }),
            },
          })
          enriched++
          onProgress?.(enriched)
        }
        // Don't mark failed enrichments as '[]' — leave semanticTags: null so
        // they are retried on the next pipeline run without needing force=true.
      }
    })

    await runWithConcurrency(batchTasks, ENRICH_CONCURRENCY)

    if (rows.length < CHUNK) break
  }

  return enriched
}

/**
 * Generate semantic tags for a single bookmark (used for on-demand re-enrichment).
 * For bulk processing use enrichAllBookmarks instead.
 */
export async function enrichBookmarkSemanticTags(
  bookmarkId: string,
  tweetText: string,
  imageTags: string[],
  client: Anthropic,
  entities?: BookmarkForEnrichment['entities'],
): Promise<string[]> {
  const results = await enrichBatchSemanticTags(
    [{ id: bookmarkId, text: tweetText, imageTags, entities }],
    client,
  )
  const result = results[0]
  if (!result?.tags.length) return []

  await prisma.bookmark.update({
    where: { id: bookmarkId },
    data: {
      semanticTags: JSON.stringify(result.tags),
      enrichmentMeta: JSON.stringify({
        sentiment: result.sentiment,
        people: result.people,
        companies: result.companies,
      }),
    },
  })
  return result.tags
}
