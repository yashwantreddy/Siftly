import prisma from '@/lib/db'
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_VISION_MODEL,
  ImageVisionProvider,
  parseImageVisionProvider,
  sanitizeOllamaBaseUrl,
  sanitizeOllamaVisionModel,
} from '@/lib/image-vision-config'

// Module-level model cache — avoids hundreds of DB roundtrips per pipeline run
let _cachedModel: string | null = null
let _modelCacheExpiry = 0
let _cachedImageVisionProvider: ImageVisionProvider | null = null
let _imageVisionProviderExpiry = 0
let _cachedOllamaBaseUrl: string | null = null
let _ollamaBaseUrlExpiry = 0
let _cachedOllamaVisionModel: string | null = null
let _ollamaVisionModelExpiry = 0
const SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000

export function invalidateSettingCache(key: 'anthropicModel' | 'imageVisionProvider' | 'ollamaBaseUrl' | 'ollamaVisionModel'): void {
  switch (key) {
    case 'anthropicModel':
      _cachedModel = null
      _modelCacheExpiry = 0
      return
    case 'imageVisionProvider':
      _cachedImageVisionProvider = null
      _imageVisionProviderExpiry = 0
      return
    case 'ollamaBaseUrl':
      _cachedOllamaBaseUrl = null
      _ollamaBaseUrlExpiry = 0
      return
    case 'ollamaVisionModel':
      _cachedOllamaVisionModel = null
      _ollamaVisionModelExpiry = 0
      return
  }
}

/**
 * Get the configured Anthropic model from settings (cached for 5 minutes).
 */
export async function getAnthropicModel(): Promise<string> {
  if (_cachedModel && Date.now() < _modelCacheExpiry) return _cachedModel
  const setting = await prisma.setting.findUnique({ where: { key: 'anthropicModel' } })
  _cachedModel = setting?.value ?? 'claude-opus-4-6'
  _modelCacheExpiry = Date.now() + SETTINGS_CACHE_TTL_MS
  return _cachedModel
}

export async function getImageVisionProvider(): Promise<ImageVisionProvider> {
  if (_cachedImageVisionProvider && Date.now() < _imageVisionProviderExpiry) return _cachedImageVisionProvider
  const setting = await prisma.setting.findUnique({ where: { key: 'imageVisionProvider' } })
  _cachedImageVisionProvider = parseImageVisionProvider(setting?.value)
  _imageVisionProviderExpiry = Date.now() + SETTINGS_CACHE_TTL_MS
  return _cachedImageVisionProvider
}

export async function getOllamaBaseUrl(): Promise<string> {
  if (_cachedOllamaBaseUrl && Date.now() < _ollamaBaseUrlExpiry) return _cachedOllamaBaseUrl
  const setting = await prisma.setting.findUnique({ where: { key: 'ollamaBaseUrl' } })
  _cachedOllamaBaseUrl = sanitizeOllamaBaseUrl(setting?.value ?? DEFAULT_OLLAMA_BASE_URL)
  _ollamaBaseUrlExpiry = Date.now() + SETTINGS_CACHE_TTL_MS
  return _cachedOllamaBaseUrl
}

export async function getOllamaVisionModel(): Promise<string> {
  if (_cachedOllamaVisionModel && Date.now() < _ollamaVisionModelExpiry) return _cachedOllamaVisionModel
  const setting = await prisma.setting.findUnique({ where: { key: 'ollamaVisionModel' } })
  _cachedOllamaVisionModel = sanitizeOllamaVisionModel(setting?.value ?? DEFAULT_OLLAMA_VISION_MODEL)
  _ollamaVisionModelExpiry = Date.now() + SETTINGS_CACHE_TTL_MS
  return _cachedOllamaVisionModel
}
