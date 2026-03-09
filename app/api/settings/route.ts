import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_VISION_MODEL,
  IMAGE_VISION_PROVIDERS,
  isValidOllamaBaseUrl,
  parseImageVisionProvider,
  sanitizeOllamaBaseUrl,
  sanitizeOllamaVisionModel,
} from '@/lib/image-vision-config'
import { invalidateSettingCache } from '@/lib/settings'

function maskKey(raw: string | null): string | null {
  if (!raw) return null
  if (raw.length <= 8) return '********'
  return `${raw.slice(0, 6)}${'*'.repeat(raw.length - 10)}${raw.slice(-4)}`
}

const ALLOWED_ANTHROPIC_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
] as const

export async function GET(): Promise<NextResponse> {
  try {
    const [anthropic, anthropicModel, imageVisionProvider, ollamaBaseUrl, ollamaVisionModel] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'anthropicApiKey' } }),
      prisma.setting.findUnique({ where: { key: 'anthropicModel' } }),
      prisma.setting.findUnique({ where: { key: 'imageVisionProvider' } }),
      prisma.setting.findUnique({ where: { key: 'ollamaBaseUrl' } }),
      prisma.setting.findUnique({ where: { key: 'ollamaVisionModel' } }),
    ])

    return NextResponse.json({
      anthropicApiKey: maskKey(anthropic?.value ?? null),
      hasAnthropicKey: anthropic !== null,
      anthropicModel: anthropicModel?.value ?? 'claude-opus-4-6',
      imageVisionProvider: parseImageVisionProvider(imageVisionProvider?.value),
      ollamaBaseUrl: sanitizeOllamaBaseUrl(ollamaBaseUrl?.value ?? DEFAULT_OLLAMA_BASE_URL),
      ollamaVisionModel: sanitizeOllamaVisionModel(ollamaVisionModel?.value ?? DEFAULT_OLLAMA_VISION_MODEL),
    })
  } catch (err) {
    console.error('Settings GET error:', err)
    return NextResponse.json(
      { error: `Failed to fetch settings: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: {
    anthropicApiKey?: string
    anthropicModel?: string
    imageVisionProvider?: string
    ollamaBaseUrl?: string
    ollamaVisionModel?: string
  } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { anthropicApiKey, anthropicModel, imageVisionProvider, ollamaBaseUrl, ollamaVisionModel } = body

  // Save Anthropic model if provided
  if (anthropicModel !== undefined) {
    if (!(ALLOWED_ANTHROPIC_MODELS as readonly string[]).includes(anthropicModel)) {
      return NextResponse.json({ error: 'Invalid Anthropic model' }, { status: 400 })
    }
    await prisma.setting.upsert({
      where: { key: 'anthropicModel' },
      update: { value: anthropicModel },
      create: { key: 'anthropicModel', value: anthropicModel },
    })
    invalidateSettingCache('anthropicModel')
    return NextResponse.json({ saved: true })
  }

  if (imageVisionProvider !== undefined) {
    if (!(IMAGE_VISION_PROVIDERS as readonly string[]).includes(imageVisionProvider)) {
      return NextResponse.json({ error: 'Invalid image vision provider' }, { status: 400 })
    }
    const provider = parseImageVisionProvider(imageVisionProvider)
    await prisma.setting.upsert({
      where: { key: 'imageVisionProvider' },
      update: { value: provider },
      create: { key: 'imageVisionProvider', value: provider },
    })
    invalidateSettingCache('imageVisionProvider')
    return NextResponse.json({ saved: true })
  }

  if (ollamaBaseUrl !== undefined) {
    if (typeof ollamaBaseUrl !== 'string') {
      return NextResponse.json({ error: 'Invalid ollamaBaseUrl value' }, { status: 400 })
    }
    const sanitized = sanitizeOllamaBaseUrl(ollamaBaseUrl)
    if (!isValidOllamaBaseUrl(sanitized)) {
      return NextResponse.json({ error: 'Invalid Ollama base URL' }, { status: 400 })
    }
    await prisma.setting.upsert({
      where: { key: 'ollamaBaseUrl' },
      update: { value: sanitized },
      create: { key: 'ollamaBaseUrl', value: sanitized },
    })
    invalidateSettingCache('ollamaBaseUrl')
    return NextResponse.json({ saved: true })
  }

  if (ollamaVisionModel !== undefined) {
    if (typeof ollamaVisionModel !== 'string') {
      return NextResponse.json({ error: 'Invalid ollamaVisionModel value' }, { status: 400 })
    }
    const sanitized = sanitizeOllamaVisionModel(ollamaVisionModel)
    await prisma.setting.upsert({
      where: { key: 'ollamaVisionModel' },
      update: { value: sanitized },
      create: { key: 'ollamaVisionModel', value: sanitized },
    })
    invalidateSettingCache('ollamaVisionModel')
    return NextResponse.json({ saved: true })
  }

  // Save Anthropic key if provided
  if (anthropicApiKey !== undefined) {
    if (typeof anthropicApiKey !== 'string' || anthropicApiKey.trim() === '') {
      return NextResponse.json({ error: 'Invalid anthropicApiKey value' }, { status: 400 })
    }
    const trimmed = anthropicApiKey.trim()
    try {
      await prisma.setting.upsert({
        where: { key: 'anthropicApiKey' },
        update: { value: trimmed },
        create: { key: 'anthropicApiKey', value: trimmed },
      })
      return NextResponse.json({ saved: true })
    } catch (err) {
      console.error('Settings POST (anthropic) error:', err)
      return NextResponse.json(
        { error: `Failed to save: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({ error: 'No setting provided' }, { status: 400 })
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  let body: { key?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const allowed = ['anthropicApiKey']
  if (!body.key || !allowed.includes(body.key)) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 })
  }

  await prisma.setting.deleteMany({ where: { key: body.key } })
  return NextResponse.json({ deleted: true })
}
