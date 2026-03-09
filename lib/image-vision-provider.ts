import Anthropic from '@anthropic-ai/sdk'
import { logOllamaResponseDebug } from '@/lib/ollama-debug'

const REQUIRED_VISION_FIELDS = [
  'people',
  'text_ocr',
  'objects',
  'scene',
  'action',
  'mood',
  'style',
  'meme_template',
  'tags',
] as const

export type AllowedMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

export interface VisionImagePayload {
  data: string
  mediaType: AllowedMediaType
}

export interface ImageVisionProviderClient {
  analyze(image: VisionImagePayload): Promise<string>
}

export class ImageVisionProviderError extends Error {
  code: 'config' | 'network' | 'response'
  provider: 'anthropic' | 'ollama'
  retryable: boolean

  constructor(
    message: string,
    options: {
      code: 'config' | 'network' | 'response'
      provider: 'anthropic' | 'ollama'
      retryable?: boolean
    },
  ) {
    super(message)
    this.name = 'ImageVisionProviderError'
    this.code = options.code
    this.provider = options.provider
    this.retryable = options.retryable ?? false
  }
}

const ANALYSIS_PROMPT = `Analyze this image for a bookmark search system. Return ONLY valid JSON, no markdown, no explanation.

{
  "people": ["description of each person visible — age, gender, appearance, expression, what they're doing"],
  "text_ocr": ["ALL visible text exactly as written — signs, captions, UI text, meme text, headlines, code"],
  "objects": ["significant objects, brands, logos, symbols, technology"],
  "scene": "brief scene description — setting and platform (e.g. 'Twitter screenshot', 'office desk', 'terminal window')",
  "action": "what is happening or being shown",
  "mood": "emotional tone: humorous/educational/alarming/inspiring/satirical/celebratory/neutral",
  "style": "photo/screenshot/meme/chart/infographic/artwork/gif/code/diagram",
  "meme_template": "specific meme template name if applicable, else null",
  "tags": ["30-40 specific searchable tags — topics, synonyms, proper nouns, brands, actions, emotions"]
}

Rules:
- text_ocr: transcribe ALL readable text exactly, word for word
- If a financial chart: include asset name, direction (up/down), timeframe
- If code: include language, key function/concept names
- If a meme: include the exact template name
- tags: be maximally specific — include brand names, person names, tool names, technical terms
- BAD tags: "twitter", "post", "image", "screenshot" (too generic)
- GOOD tags: "bitcoin price chart", "react hooks", "frustrated man", "gpt-4", "bull market"`

export function getImageVisionPrompt(): string {
  return ANALYSIS_PROMPT
}

export function getImageVisionTestPrompt(): string {
  return `${ANALYSIS_PROMPT}

Use the exact JSON schema above.`
}

function extractTextFromAnthropicMessage(message: Anthropic.Messages.Message): string {
  const raw = message.content.find((block) => block.type === 'text')?.text?.trim() ?? ''
  if (!raw) {
    throw new ImageVisionProviderError('Anthropic returned no text content for image analysis.', {
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

  throw new ImageVisionProviderError('Ollama returned no text content for image analysis.', {
    code: 'response',
    provider: 'ollama',
  })
}

function validateVisionShape(parsed: Record<string, unknown>, provider: 'anthropic' | 'ollama'): void {
  const missing = REQUIRED_VISION_FIELDS.filter((field) => !(field in parsed))
  if (missing.length > 0) {
    throw new ImageVisionProviderError(
      `Vision response missing required vision fields: ${missing.join(', ')}`,
      { code: 'response', provider },
    )
  }
}

export function extractCanonicalVisionJson(
  raw: string,
  provider: 'anthropic' | 'ollama' = 'ollama',
): string {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new ImageVisionProviderError('Vision response did not contain a JSON object.', {
      code: 'response',
      provider,
    })
  }

  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  validateVisionShape(parsed, provider)

  const canonical = {
    people: parsed.people,
    text_ocr: parsed.text_ocr,
    objects: parsed.objects,
    scene: parsed.scene,
    action: parsed.action,
    mood: parsed.mood,
    style: parsed.style,
    meme_template: parsed.meme_template ?? null,
    tags: parsed.tags,
  }

  return JSON.stringify(canonical)
}

export function createAnthropicImageVisionProvider(options: {
  client: Anthropic
  model: string
}): ImageVisionProviderClient {
  return {
    async analyze(image) {
      const message = await options.client.messages.create({
        model: options.model,
        max_tokens: 700,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
              { type: 'text', text: ANALYSIS_PROMPT },
            ],
          },
        ],
      })

      return extractCanonicalVisionJson(extractTextFromAnthropicMessage(message), 'anthropic')
    },
  }
}

export function createOllamaImageVisionProvider(options: {
  baseUrl: string
  model: string
  fetchImpl?: typeof fetch
}): ImageVisionProviderClient {
  const fetchImpl = options.fetchImpl ?? fetch

  return {
    async analyze(image) {
      let response: Response
      try {
        response = await fetchImpl(`${options.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: options.model,
            stream: false,
            messages: [
              {
                role: 'user',
                content: ANALYSIS_PROMPT,
                images: [image.data],
              },
            ],
          }),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new ImageVisionProviderError(`Ollama image vision request failed: ${message}`, {
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

        throw new ImageVisionProviderError(`Ollama image vision error: ${errorMessage}`, {
          code: response.status >= 500 ? 'network' : 'config',
          provider: 'ollama',
          retryable: false,
        })
      }

      const rawText = extractTextFromOllamaResponse(payload)
      logOllamaResponseDebug('image-vision', rawText)
      return extractCanonicalVisionJson(rawText, 'ollama')
    },
  }
}

export async function testOllamaConnection(options: {
  baseUrl: string
  model: string
  fetchImpl?: typeof fetch
}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch

  let response: Response
  try {
    response = await fetchImpl(`${options.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        prompt: 'Respond with OK.',
        stream: false,
      }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ImageVisionProviderError(`Failed to reach Ollama: ${message}`, {
      code: 'network',
      provider: 'ollama',
    })
  }

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const errorMessage = payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).error === 'string'
      ? (payload as Record<string, unknown>).error as string
      : `HTTP ${response.status}`

    throw new ImageVisionProviderError(`Ollama test failed: ${errorMessage}`, {
      code: response.status >= 500 ? 'network' : 'config',
      provider: 'ollama',
    })
  }
}
