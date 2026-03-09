import Anthropic from '@anthropic-ai/sdk'
import { ImageVisionProviderError } from '@/lib/image-vision-provider'
import { buildImageContext } from '@/lib/image-context'
import type { ImageVisionProvider } from '@/lib/image-vision-config'
import { logOllamaResponseDebug } from '@/lib/ollama-debug'

const REQUIRED_ENRICHMENT_FIELDS = ['id', 'tags', 'sentiment', 'people', 'companies'] as const

export interface BookmarkForEnrichment {
  id: string
  text: string
  imageTags: string[]
  entities?: {
    hashtags?: string[]
    urls?: string[]
    mentions?: string[]
    tools?: string[]
    tweetType?: string
  }
}

export interface EnrichmentResult {
  id: string
  tags: string[]
  sentiment: string
  people: string[]
  companies: string[]
}

export interface SemanticEnrichmentProvider {
  enrich(bookmarksJson: string): Promise<EnrichmentResult[]>
}

export function getPipelineAiRequirements(provider: ImageVisionProvider): {
  needsAnthropicForVision: boolean
  needsAnthropicForEnrichment: boolean
  needsAnthropicForCategorization: boolean
} {
  return {
    needsAnthropicForVision: provider === 'anthropic',
    needsAnthropicForEnrichment: provider === 'anthropic',
    needsAnthropicForCategorization: provider === 'anthropic',
  }
}

export function buildSemanticEnrichmentItems(bookmarks: BookmarkForEnrichment[]): string {
  const items = bookmarks.map((bookmark) => {
    const entry: Record<string, unknown> = { id: bookmark.id, text: bookmark.text.slice(0, 500) }
    const imgCtx = bookmark.imageTags.map((raw) => buildImageContext(raw)).filter(Boolean).join(' | ')
    if (imgCtx) entry.imageContext = imgCtx
    if (bookmark.entities?.hashtags?.length) entry.hashtags = bookmark.entities.hashtags.slice(0, 8)
    if (bookmark.entities?.tools?.length) entry.tools = bookmark.entities.tools
    if (bookmark.entities?.mentions?.length) entry.mentions = bookmark.entities.mentions.slice(0, 3)
    return entry
  })

  return JSON.stringify(items, null, 1)
}

export function getSemanticEnrichmentPrompt(bookmarksJson: string): string {
  return `Generate search tags and metadata for each of these Twitter/X bookmarks.

For each bookmark return:
- tags: 25-35 specific semantic search tags covering entities, actions, visual content, synonyms, and emotional signals
- sentiment: one of "positive", "negative", "neutral", "humorous", "controversial"
- people: named people mentioned or shown (max 5, empty array if none)
- companies: company/product/tool names explicitly referenced (max 8, empty array if none)

Rules for tags:
- 2-5 words max, specific beats generic
- NO generic terms: "twitter post", "screenshot", "social media", "content"
- YES to proper nouns, version numbers, specific concepts
- Rank most-search-relevant tags first

Return ONLY valid JSON, no markdown:
[{"id":"...","tags":[...],"sentiment":"...","people":[...],"companies":[...]}]

BOOKMARKS:
${bookmarksJson}`
}

export function getSemanticEnrichmentTestPrompt(): string {
  return getSemanticEnrichmentPrompt('[{"id":"demo"}]')
}

export function parseEnrichmentResponse(text: string): EnrichmentResult[] {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []
  const parsed: unknown = JSON.parse(match[0])
  if (!Array.isArray(parsed)) return []
  return (parsed as Record<string, unknown>[]).map((item): EnrichmentResult => ({
    id: String(item.id ?? ''),
    tags: Array.isArray(item.tags) ? (item.tags as unknown[]).map(String).filter(Boolean) : [],
    sentiment: String(item.sentiment ?? 'neutral'),
    people: Array.isArray(item.people) ? (item.people as unknown[]).map(String).filter(Boolean) : [],
    companies: Array.isArray(item.companies) ? (item.companies as unknown[]).map(String).filter(Boolean) : [],
  })).filter((row) => row.id)
}

export function extractCanonicalEnrichmentJson(text: string): string {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) {
    throw new Error('Enrichment response did not contain a JSON array.')
  }

  const parsed = JSON.parse(match[0]) as Record<string, unknown>[]
  if (!Array.isArray(parsed)) {
    throw new Error('Enrichment response was not a JSON array.')
  }

  for (const row of parsed) {
    const missing = REQUIRED_ENRICHMENT_FIELDS.filter((field) => !(field in row))
    if (missing.length > 0) {
      throw new Error(`Response missing required enrichment fields: ${missing.join(', ')}`)
    }
  }

  return JSON.stringify(parsed)
}

function extractTextFromOllamaResponse(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    throw new ImageVisionProviderError('Ollama returned an invalid response payload.', {
      code: 'response',
      provider: 'ollama',
    })
  }

  const record = payload as Record<string, unknown>
  const message = record.message
  if (message && typeof message === 'object' && typeof (message as Record<string, unknown>).content === 'string') {
    return ((message as Record<string, unknown>).content as string).trim()
  }
  if (typeof record.response === 'string') return record.response.trim()

  throw new ImageVisionProviderError('Ollama returned no text content for semantic enrichment.', {
    code: 'response',
    provider: 'ollama',
  })
}

export function createAnthropicSemanticEnrichmentProvider(options: {
  client: Anthropic
  model: string
}): SemanticEnrichmentProvider {
  return {
    async enrich(bookmarksJson) {
      const message = await options.client.messages.create({
        model: options.model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: getSemanticEnrichmentPrompt(bookmarksJson) }],
      })
      const text = message.content.find((block) => block.type === 'text')?.text ?? ''
      return parseEnrichmentResponse(text)
    },
  }
}

export function createOllamaSemanticEnrichmentProvider(options: {
  baseUrl: string
  model: string
  fetchImpl?: typeof fetch
}): SemanticEnrichmentProvider {
  const fetchImpl = options.fetchImpl ?? fetch

  return {
    async enrich(bookmarksJson) {
      let response: Response
      try {
        response = await fetchImpl(`${options.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: options.model,
            stream: false,
            messages: [{ role: 'user', content: getSemanticEnrichmentPrompt(bookmarksJson) }],
          }),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new ImageVisionProviderError(`Ollama semantic enrichment request failed: ${message}`, {
          code: 'network',
          provider: 'ollama',
          retryable: false,
        })
      }

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const errorMessage = payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).error === 'string'
          ? (payload as Record<string, unknown>).error as string
          : `HTTP ${response.status}`

        throw new ImageVisionProviderError(`Ollama semantic enrichment error: ${errorMessage}`, {
          code: response.status >= 500 ? 'network' : 'config',
          provider: 'ollama',
          retryable: false,
        })
      }

      const rawText = extractTextFromOllamaResponse(payload)
      logOllamaResponseDebug('semantic-enrichment', rawText)
      return parseEnrichmentResponse(extractCanonicalEnrichmentJson(rawText))
    },
  }
}
