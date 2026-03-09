export const IMAGE_VISION_PROVIDERS = ['anthropic', 'ollama'] as const

export type ImageVisionProvider = (typeof IMAGE_VISION_PROVIDERS)[number]

export const DEFAULT_IMAGE_VISION_PROVIDER: ImageVisionProvider = 'anthropic'
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
export const DEFAULT_OLLAMA_VISION_MODEL = 'gemma3:4b'

export function parseImageVisionProvider(value: string | null | undefined): ImageVisionProvider {
  return value === 'ollama' ? 'ollama' : DEFAULT_IMAGE_VISION_PROVIDER
}

export function sanitizeOllamaBaseUrl(value: string | null | undefined): string {
  const trimmed = value?.trim()
  if (!trimmed) return DEFAULT_OLLAMA_BASE_URL
  return trimmed.replace(/\/+$/, '')
}

export function sanitizeOllamaVisionModel(value: string | null | undefined): string {
  const trimmed = value?.trim()
  return trimmed || DEFAULT_OLLAMA_VISION_MODEL
}

export function isValidOllamaBaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
