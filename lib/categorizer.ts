import Anthropic from '@anthropic-ai/sdk'
import prisma from '@/lib/db'
import { resolveAnthropicClient, getCliAvailability, claudePrompt, modelNameToCliAlias } from '@/lib/claude-cli-auth'
import { getAnthropicModel, getImageVisionProvider, getOllamaBaseUrl, getOllamaVisionModel } from '@/lib/settings'
import {
  buildCategorizationPrompt,
  BookmarkForCategorization,
  CategorizationResult,
  createAnthropicCategorizationProvider,
  createOllamaCategorizationProvider,
  parseCategorizationResponse,
} from '@/lib/categorization-provider'

const BATCH_SIZE = 20

const DEFAULT_CATEGORIES = [
  {
    name: 'AI & Machine Learning',
    slug: 'ai-resources',
    color: '#8b5cf6',
    description:
      'Artificial intelligence, machine learning, LLMs, ChatGPT, Claude, Gemini, Grok, Midjourney, Sora, AI agents, RAG, fine-tuning, prompts, vector databases, model benchmarks, AI startups, AI safety, multimodal models',
    isAiGenerated: false,
  },
  {
    name: 'Crypto & Web3',
    slug: 'finance-crypto',
    color: '#f59e0b',
    description:
      'Cryptocurrency, Bitcoin, Ethereum, Solana, DeFi protocols, NFTs, on-chain activity, crypto trading, altcoins, airdrops, memecoin, Web3 development, smart contracts, DAOs, Layer 2, Uniswap, pump.fun, wallets, blockchain analytics',
    isAiGenerated: false,
  },
  {
    name: 'Dev Tools & Engineering',
    slug: 'dev-tools',
    color: '#06b6d4',
    description:
      'Software engineering, coding, GitHub, open source, frameworks, APIs, databases, DevOps, CI/CD, terminal tools, debugging, system design, backend, frontend, mobile dev, Rust, Go, TypeScript, Python, Vercel, Supabase, Docker',
    isAiGenerated: false,
  },
  {
    name: 'Finance & Investing',
    slug: 'finance-investing',
    color: '#10b981',
    description:
      'Stock market, equities, options trading, macroeconomics, Federal Reserve, interest rates, hedge funds, venture capital, private equity, earnings reports, portfolio management, real estate investing, commodities, forex, financial charts — NOT crypto',
    isAiGenerated: false,
  },
  {
    name: 'Startups & Business',
    slug: 'startups-business',
    color: '#f97316',
    description:
      'Startups, founders, entrepreneurship, SaaS, product-market fit, fundraising, VC, angel investing, growth hacking, B2B, marketing, sales, revenue, bootstrapping, Y Combinator, acquisition, company building, business strategy',
    isAiGenerated: false,
  },
  {
    name: 'News & Politics',
    slug: 'news',
    color: '#6366f1',
    description:
      'Breaking news, current events, US politics, global politics, geopolitics, government policy, elections, regulation, tech policy, AI regulation, crypto regulation, war and conflict, international relations, journalism, investigative reporting',
    isAiGenerated: false,
  },
  {
    name: 'Design & Product',
    slug: 'design',
    color: '#ec4899',
    description:
      'UI/UX design, product design, visual design, Figma, typography, design systems, motion design, brand identity, user research, product strategy, wireframes, creative tools, color theory, web design, app design',
    isAiGenerated: false,
  },
  {
    name: 'Health & Wellness',
    slug: 'health-wellness',
    color: '#14b8a6',
    description:
      'Fitness, nutrition, longevity, biohacking, sleep, mental health, supplements, workout routines, diet, weight loss, strength training, cognitive performance, stress management, meditation, gut health, lab results, wearables like Whoop and Oura',
    isAiGenerated: false,
  },
  {
    name: 'Security & Privacy',
    slug: 'security-privacy',
    color: '#ef4444',
    description:
      'Cybersecurity, hacking, exploits, vulnerabilities, OPSEC, privacy tools, VPNs, encryption, threat intelligence, social engineering, phishing, malware, zero-days, pen testing, CTF, data breaches, authentication, identity security',
    isAiGenerated: false,
  },
  {
    name: 'Science & Research',
    slug: 'science-research',
    color: '#3b82f6',
    description:
      'Scientific research, papers, discoveries, physics, biology, neuroscience, space exploration, climate, chemistry, medical breakthroughs, academic studies, emerging technology, robotics, quantum computing, energy, materials science',
    isAiGenerated: false,
  },
  {
    name: 'Productivity',
    slug: 'productivity',
    color: '#a855f7',
    description:
      'Productivity systems, time management, habits, focus techniques, note-taking, second brain, deep work, mental models, PKM tools like Obsidian and Notion, life optimization, workflows, automation, delegation',
    isAiGenerated: false,
  },
  {
    name: 'Funny & Memes',
    slug: 'funny-memes',
    color: '#eab308',
    description:
      'Memes, jokes, satire, humor, viral content, relatable posts, shitposts, funny screenshots, comedy threads, parody, ironic takes — content whose primary purpose is to be funny or entertaining',
    isAiGenerated: false,
  },
  {
    name: 'General',
    slug: 'general',
    color: '#64748b',
    description: "Miscellaneous content that doesn't clearly fit any other category — use sparingly, only when no other category applies",
    isAiGenerated: false,
  },
] as const

// Default slugs only used for seeding - all runtime categorization uses DB slugs
const DEFAULT_SLUGS = DEFAULT_CATEGORIES.map((c) => c.slug)

export async function seedDefaultCategories(): Promise<void> {
  const existing = await prisma.category.findMany({ select: { slug: true } })
  const existingSlugs = new Set(existing.map((c) => c.slug))

  for (const cat of DEFAULT_CATEGORIES) {
    if (existingSlugs.has(cat.slug)) {
      // Sync name, color, and description so renames/updates propagate to existing DBs
      await prisma.category.update({
        where: { slug: cat.slug },
        data: { name: cat.name, color: cat.color, description: cat.description },
      })
    } else {
      await prisma.category.create({ data: { ...cat } })
    }
  }
}

export async function categorizeBatch(
  bookmarks: BookmarkForCategorization[],
  client: Anthropic | null,
  categoryDescriptions: Record<string, string> = {},
  allSlugs: string[] = DEFAULT_SLUGS,
): Promise<CategorizationResult[]> {
  if (bookmarks.length === 0) return []

  const prompt = buildCategorizationPrompt(bookmarks, categoryDescriptions, allSlugs)
  const validSlugs = new Set(allSlugs)
  const preprocessingProvider = await getImageVisionProvider()

  if (preprocessingProvider === 'ollama') {
    const provider = createOllamaCategorizationProvider({
      baseUrl: await getOllamaBaseUrl(),
      model: await getOllamaVisionModel(),
    })
    return provider.categorize(prompt, validSlugs)
  }

  // Prefer CLI over SDK (avoids OAuth token extraction, uses CLI directly)
  if (await getCliAvailability()) {
    const modelSetting = await getAnthropicModel()
    const cliModel = modelNameToCliAlias(modelSetting)

    const result = await claudePrompt(prompt, { model: cliModel, timeoutMs: 60_000 })
    if (result.success && result.data) {
      try {
        return parseCategorizationResponse(result.data, validSlugs)
      } catch (parseErr) {
        console.warn('[categorize] CLI response parse failed, falling back to SDK:', parseErr)
      }
    } else {
      console.warn('[categorize] CLI failed, falling back to SDK:', result.error)
    }
  }

  // Fallback to SDK (requires API key)
  if (!client) {
    throw new Error('Claude CLI not available and no API key configured.')
  }

  const model = await getAnthropicModel()
  return createAnthropicCategorizationProvider({ client, model }).categorize(prompt, validSlugs)
}

export async function writeCategoryResults(results: CategorizationResult[]): Promise<void> {
  if (results.length === 0) return

  const tweetIds = results.map((r) => r.tweetId).filter(Boolean)
  if (tweetIds.length === 0) return

  // Batch-fetch all categories and bookmarks at once (eliminates N+1 queries)
  const [categories, bookmarks] = await Promise.all([
    prisma.category.findMany({ select: { id: true, slug: true } }),
    prisma.bookmark.findMany({
      where: { tweetId: { in: tweetIds } },
      select: { id: true, tweetId: true },
    }),
  ])

  const categoryBySlug = new Map(categories.map((c) => [c.slug, c.id]))
  const bookmarkByTweetId = new Map(bookmarks.map((b) => [b.tweetId, b.id]))
  const now = new Date()

  // Collect all operations then execute in a single transaction (eliminates sequential await overhead)
  const upsertOps: ReturnType<typeof prisma.bookmarkCategory.upsert>[] = []
  const bookmarkIdsToUpdate: string[] = []

  for (const result of results) {
    if (!result.tweetId || result.assignments.length === 0) continue
    const bookmarkId = bookmarkByTweetId.get(result.tweetId)
    if (!bookmarkId) continue

    for (const { category: slug, confidence } of result.assignments) {
      const categoryId = categoryBySlug.get(slug)
      if (!categoryId) continue
      upsertOps.push(
        prisma.bookmarkCategory.upsert({
          where: { bookmarkId_categoryId: { bookmarkId, categoryId } },
          update: { confidence },
          create: { bookmarkId, categoryId, confidence },
        }),
      )
    }
    bookmarkIdsToUpdate.push(bookmarkId)
  }

  if (upsertOps.length === 0) return

  await prisma.$transaction([
    ...upsertOps,
    prisma.bookmark.updateMany({
      where: { id: { in: bookmarkIdsToUpdate } },
      data: { enrichedAt: now },
    }),
  ])
}

export function mapBookmarkForCategorization(b: {
  tweetId: string
  text: string
  semanticTags: string | null
  entities: string | null
  mediaItems: { imageTags: string | null }[]
}): BookmarkForCategorization {
  const allImageTags = b.mediaItems
    .map((m) => m.imageTags)
    .filter((t): t is string => t !== null && t !== '')
    .join(' | ')

  let semanticTags: string[] | undefined
  if (b.semanticTags) {
    try { semanticTags = JSON.parse(b.semanticTags) as string[] } catch { /* ignore */ }
  }

  let hashtags: string[] | undefined
  let tools: string[] | undefined
  if (b.entities) {
    try {
      const ent = JSON.parse(b.entities) as { hashtags?: string[]; tools?: string[] }
      hashtags = ent.hashtags
      tools = ent.tools
    } catch { /* ignore */ }
  }

  return {
    tweetId: b.tweetId,
    text: b.text,
    imageTags: allImageTags || undefined,
    semanticTags,
    hashtags,
    tools,
  }
}

export const BOOKMARK_SELECT = {
  id: true,
  tweetId: true,
  text: true,
  semanticTags: true,
  entities: true,
  mediaItems: { select: { imageTags: true } },
} as const

export async function categorizeAll(
  bookmarkIds: string[],
  onProgress?: (done: number, total: number) => void,
  force = false,
  shouldAbort?: () => boolean,
): Promise<void> {
  await seedDefaultCategories()

  const preprocessingProvider = await getImageVisionProvider()

  // Resolve auth once for Anthropic-backed categorization — avoids re-resolving inside every batch call
  const apiKeySetting = await prisma.setting.findUnique({ where: { key: 'anthropicApiKey' } })
  let client: Anthropic | null = null
  if (preprocessingProvider === 'anthropic') {
    client = resolveAnthropicClient({ dbKey: apiKeySetting?.value })
  }

  // Load ALL categories (default + custom) for the prompt
  const dbCategories = await prisma.category.findMany({ select: { slug: true, name: true, description: true } })
  const allSlugs = dbCategories.map((c) => c.slug)
  const categoryDescriptions = Object.fromEntries(
    dbCategories.map((c) => [c.slug, c.description?.trim() || c.name]),
  )

  // Get total count for progress reporting (without loading all rows)
  let total = 0
  if (bookmarkIds.length > 0) {
    total = bookmarkIds.length
  } else if (force) {
    total = await prisma.bookmark.count()
  } else {
    total = await prisma.bookmark.count({ where: { enrichedAt: null } })
  }

  let done = 0

  if (bookmarkIds.length > 0) {
    // Specific bookmark IDs — fetch in BATCH_SIZE chunks
    for (let i = 0; i < bookmarkIds.length; i += BATCH_SIZE) {
      if (shouldAbort?.()) break
      const batchIds = bookmarkIds.slice(i, i + BATCH_SIZE)
      const rows = await prisma.bookmark.findMany({
        where: { id: { in: batchIds } },
        select: BOOKMARK_SELECT,
      })
      const batch = rows.map(mapBookmarkForCategorization)
      try {
        const results = await categorizeBatch(batch, client, categoryDescriptions, allSlugs)
        await writeCategoryResults(results)
      } catch (err) {
        console.error(`Error categorizing batch at index ${i}:`, err)
      }
      done = Math.min(i + BATCH_SIZE, total)
      onProgress?.(done, total)
    }
  } else {
    // Cursor-based pagination — never loads all bookmarks into memory
    let cursor: string | undefined
    const where = force ? {} : { enrichedAt: null }

    while (true) {
      if (shouldAbort?.()) break

      const rows = await prisma.bookmark.findMany({
        where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: BOOKMARK_SELECT,
      })

      if (rows.length === 0) break
      cursor = rows[rows.length - 1].id

      const batch = rows.map(mapBookmarkForCategorization)
      try {
        const results = await categorizeBatch(batch, client, categoryDescriptions, allSlugs)
        await writeCategoryResults(results)
      } catch (err) {
        console.error('Error categorizing batch:', err)
      }

      done += rows.length
      onProgress?.(Math.min(done, total), total)

      if (rows.length < BATCH_SIZE) break
    }
  }
}
