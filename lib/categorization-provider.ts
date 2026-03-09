import Anthropic from '@anthropic-ai/sdk'
import { ImageVisionProviderError } from '@/lib/image-vision-provider'
import { buildImageContext } from '@/lib/image-context'
import { logOllamaResponseDebug } from '@/lib/ollama-debug'

const REQUIRED_CATEGORIZATION_FIELDS = ['tweetId', 'assignments'] as const

export interface BookmarkForCategorization {
  tweetId: string
  text: string
  imageTags?: string
  semanticTags?: string[]
  hashtags?: string[]
  tools?: string[]
}

export interface CategoryAssignment {
  category: string
  confidence: number
}

export interface CategorizationResult {
  tweetId: string
  assignments: CategoryAssignment[]
}

export interface CategorizationProvider {
  categorize(prompt: string, validSlugs: Set<string>): Promise<CategorizationResult[]>
}

export function buildCategorizationPrompt(
  bookmarks: BookmarkForCategorization[],
  categoryDescriptions: Record<string, string>,
  allSlugs: string[],
): string {
  const categoriesList = allSlugs.map(
    (slug) => `- ${slug}: ${categoryDescriptions[slug] ?? slug.replace(/-/g, ' ')}`,
  ).join('\n')

  const tweetData = bookmarks.map((bookmark) => {
    const entry: Record<string, unknown> = { id: bookmark.tweetId, text: bookmark.text.slice(0, 400) }
    const imageContext = buildImageContext(bookmark.imageTags)
    if (imageContext) entry.images = imageContext
    if (bookmark.semanticTags?.length) entry.aiTags = bookmark.semanticTags.slice(0, 20).join(', ')
    if (bookmark.hashtags?.length) entry.hashtags = bookmark.hashtags.slice(0, 10).join(', ')
    if (bookmark.tools?.length) entry.tools = bookmark.tools.join(', ')
    return entry
  })

  return `You are an expert librarian categorizing Twitter/X bookmarks into a personal knowledge base. Your categorizations directly power search and discovery - accuracy is critical.

AVAILABLE CATEGORIES:
${categoriesList}

CATEGORIZATION RULES:
- Assign 1-3 categories per bookmark - only what CLEARLY applies
- Confidence 0.5-1.0: use 0.9+ for obvious fits, 0.6-0.8 for plausible, 0.5 for borderline
- Priority: specific categories beat "general" - only use "general" when truly nothing else fits
- Use ALL signals: tweet text, image analysis, OCR text inside images, hashtags, detected tools, semantic AI tags

SIGNAL WEIGHTING (use all, not just text):
- Image shows financial chart, price action, wallet UI -> finance-crypto (even if tweet text is vague)
- Image shows code, terminal, GitHub, a dev tool UI -> dev-tools
- Image is clearly a meme format or labeled as humor/satire -> funny-memes with high confidence
- Tools field mentions GitHub/Vercel/React/etc -> dev-tools likely applies
- aiTags field is pre-computed context - trust it heavily for category signals
- Hashtags like #bitcoin #eth -> finance-crypto; #buildinpublic #saas -> dev-tools/productivity

AVOID:
- Over-assigning "general" - it's a catch-all, not a default
- Conflating news about AI with AI resources (a news thread about OpenAI is "news", not "ai-resources")
- Assigning categories based only on passing mentions (a dev tweet that mentions a price = dev-tools, not finance)

Return ONLY valid JSON - no markdown, no explanation:
[{
  "tweetId": "123",
  "assignments": [
    {"category": "ai-resources", "confidence": 0.92},
    {"category": "dev-tools", "confidence": 0.71}
  ]
}]

BOOKMARKS:
${JSON.stringify(tweetData, null, 1)}`
}

export function getCategorizationTestPrompt(): string {
  return buildCategorizationPrompt(
    [{ tweetId: 'demo', text: 'demo bookmark' }],
    { general: 'Fallback category' },
    ['general'],
  )
}

function normalizeCategorizationPayload(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload as Record<string, unknown>[]
  }

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>

    if (REQUIRED_CATEGORIZATION_FIELDS.every((field) => field in record)) {
      return [record]
    }

    for (const key of ['results', 'items', 'data']) {
      if (Array.isArray(record[key])) {
        return record[key] as Record<string, unknown>[]
      }
    }
  }

  throw new Error('Categorization response was not a JSON array.')
}

function tryParseCategorizationCandidate(candidate: string): Record<string, unknown>[] | null {
  try {
    return normalizeCategorizationPayload(JSON.parse(candidate))
  } catch {
    return null
  }
}

export function extractCanonicalCategorizationJson(text: string): string {
  const candidates = [
    text.trim(),
    text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(),
    text.match(/\{[\s\S]*\}/)?.[0],
    text.match(/\[[\s\S]*\]/)?.[0],
  ].filter((candidate): candidate is string => Boolean(candidate && candidate.trim()))

  let parsed: Record<string, unknown>[] | null = null
  for (const candidate of candidates) {
    parsed = tryParseCategorizationCandidate(candidate)
    if (parsed) break
  }

  if (!parsed) {
    throw new Error('Categorization response did not contain a JSON array.')
  }

  for (const row of parsed) {
    const missing = REQUIRED_CATEGORIZATION_FIELDS.filter((field) => !(field in row))
    if (missing.length > 0) {
      throw new Error(`Response missing required categorization fields: ${missing.join(', ')}`)
    }
  }

  return JSON.stringify(parsed)
}

export function parseCategorizationResponse(text: string, validSlugs: Set<string>): CategorizationResult[] {
  const parsed = JSON.parse(extractCanonicalCategorizationJson(text)) as Record<string, unknown>[]

  return parsed.map((item): CategorizationResult => {
    const tweetId = String(item.tweetId ?? '')
    const rawAssignments = Array.isArray(item.assignments) ? item.assignments : []

    const assignments: CategoryAssignment[] = (rawAssignments as Record<string, unknown>[])
      .map((assignment) => ({
        category: String(assignment.category ?? ''),
        confidence:
          typeof assignment.confidence === 'number'
            ? Math.min(1, Math.max(0.5, assignment.confidence))
            : 0.8,
      }))
      .filter((assignment) => validSlugs.has(assignment.category))

    return { tweetId, assignments }
  }).filter((row) => row.tweetId)
}

function extractTextFromAnthropicMessage(message: Anthropic.Messages.Message): string {
  const raw = message.content.find((block) => block.type === 'text')?.text?.trim() ?? ''
  if (!raw) {
    throw new ImageVisionProviderError('Anthropic returned no text content for categorization.', {
      code: 'response',
      provider: 'anthropic',
      retryable: false,
    })
  }
  return raw
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

  throw new ImageVisionProviderError('Ollama returned no text content for categorization.', {
    code: 'response',
    provider: 'ollama',
  })
}

export function createAnthropicCategorizationProvider(options: {
  client: Anthropic
  model: string
}): CategorizationProvider {
  return {
    async categorize(prompt, validSlugs) {
      const message = await options.client.messages.create({
        model: options.model,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      })

      return parseCategorizationResponse(extractTextFromAnthropicMessage(message), validSlugs)
    },
  }
}

export function createOllamaCategorizationProvider(options: {
  baseUrl: string
  model: string
  fetchImpl?: typeof fetch
}): CategorizationProvider {
  const fetchImpl = options.fetchImpl ?? fetch

  return {
    async categorize(prompt, validSlugs) {
      let response: Response
      try {
        response = await fetchImpl(`${options.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: options.model,
            stream: false,
            messages: [{ role: 'user', content: prompt }],
          }),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new ImageVisionProviderError(`Ollama categorization request failed: ${message}`, {
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

        throw new ImageVisionProviderError(`Ollama categorization error: ${errorMessage}`, {
          code: response.status >= 500 ? 'network' : 'config',
          provider: 'ollama',
          retryable: false,
        })
      }

      const rawText = extractTextFromOllamaResponse(payload)
      logOllamaResponseDebug('categorization', rawText)
      return parseCategorizationResponse(rawText, validSlugs)
    },
  }
}
