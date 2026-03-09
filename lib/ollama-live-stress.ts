import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_VISION_MODEL,
  sanitizeOllamaBaseUrl,
  sanitizeOllamaVisionModel,
} from '@/lib/image-vision-config'
import {
  createOllamaImageVisionProvider,
  type VisionImagePayload,
} from '@/lib/image-vision-provider'
import { runStressSweep, type StressSweepSummary } from '@/lib/ollama-stress'
import {
  buildSemanticEnrichmentItems,
  createOllamaSemanticEnrichmentProvider,
  type BookmarkForEnrichment,
} from '@/lib/semantic-enrichment-provider'
import {
  buildCategorizationPrompt,
  createOllamaCategorizationProvider,
  type BookmarkForCategorization,
} from '@/lib/categorization-provider'

export type StressStage = 'vision' | 'enrichment' | 'categorization' | 'both'

export interface OllamaStressConfig {
  enabled: boolean
  baseUrl: string
  model: string
  stage: StressStage
  concurrency: number[]
  timeoutMs: number
  requestsPerSweep?: number
}

export interface OllamaStressResult extends StressSweepSummary {
  stage: Exclude<StressStage, 'both'>
}

export type StressEnv = Record<string, string | undefined>

function parseBooleanFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseConcurrencyList(value: string | undefined): number[] {
  if (!value?.trim()) return [1, 2, 4, 8, 20]

  const parsed = value
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((num) => Number.isFinite(num) && num > 0)

  return parsed.length > 0 ? parsed : [1, 2, 4, 8, 20]
}

function parseStage(value: string | undefined): StressStage {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'vision' || normalized === 'enrichment' || normalized === 'categorization') return normalized
  return 'both'
}

function createAbortableFetch(signal: AbortSignal): typeof fetch {
  return (input, init) => fetch(input, { ...init, signal })
}

function buildEnrichmentPayload(index: number): string {
  const bookmark: BookmarkForEnrichment = {
    id: `stress-enrichment-${index}`,
    text: `Benchmark local Ollama throughput under concurrent bookmark preprocessing load ${index}.`,
    imageTags: [],
    entities: {
      hashtags: ['ollama', 'llm', 'benchmark'],
      tools: ['Ollama'],
      mentions: ['viperr'],
      tweetType: 'text',
    },
  }

  return buildSemanticEnrichmentItems([bookmark])
}

function buildVisionPayload(): VisionImagePayload {
  const imagePath = path.join(process.cwd(), 'tests/test-images/test-image.png')
  return {
    data: readFileSync(imagePath).toString('base64'),
    mediaType: 'image/png',
  }
}

function buildCategorizationInputs(index: number): {
  prompt: string
  validSlugs: Set<string>
} {
  const bookmark: BookmarkForCategorization = {
    tweetId: `stress-categorization-${index}`,
    text: `Testing Ollama worker concurrency for local AI preprocessing and bookmark categorization ${index}.`,
    semanticTags: ['ollama benchmark', 'local inference', 'worker concurrency'],
    tools: ['Ollama'],
    hashtags: ['ollama', 'localai'],
  }

  const allSlugs = ['ai-resources', 'dev-tools', 'general']
  const categoryDescriptions = {
    'ai-resources': 'AI tools, models, workflows, and research resources.',
    'dev-tools': 'Developer tools, coding workflows, terminals, and software infrastructure.',
    general: 'Fallback category when nothing else clearly fits.',
  }

  return {
    prompt: buildCategorizationPrompt([bookmark], categoryDescriptions, allSlugs),
    validSlugs: new Set(allSlugs),
  }
}

async function runEnrichmentTask(config: OllamaStressConfig, index: number, signal: AbortSignal): Promise<void> {
  const provider = createOllamaSemanticEnrichmentProvider({
    baseUrl: config.baseUrl,
    model: config.model,
    fetchImpl: createAbortableFetch(signal),
  })

  const rows = await provider.enrich(buildEnrichmentPayload(index))
  assert.ok(rows.length > 0, 'Expected Ollama enrichment to return at least one row.')
  assert.equal(rows[0]?.id, `stress-enrichment-${index}`)
}

async function runVisionTask(config: OllamaStressConfig, signal: AbortSignal): Promise<void> {
  const provider = createOllamaImageVisionProvider({
    baseUrl: config.baseUrl,
    model: config.model,
    fetchImpl: createAbortableFetch(signal),
  })

  const raw = await provider.analyze(buildVisionPayload())
  const parsed = JSON.parse(raw) as Record<string, unknown>
  assert.ok(Array.isArray(parsed.tags), 'Expected Ollama vision to return tags.')
}

async function runCategorizationTask(config: OllamaStressConfig, index: number, signal: AbortSignal): Promise<void> {
  const provider = createOllamaCategorizationProvider({
    baseUrl: config.baseUrl,
    model: config.model,
    fetchImpl: createAbortableFetch(signal),
  })

  const { prompt, validSlugs } = buildCategorizationInputs(index)
  const rows = await provider.categorize(prompt, validSlugs)
  assert.ok(rows.length > 0, 'Expected Ollama categorization to return at least one row.')
  assert.equal(rows[0]?.tweetId, `stress-categorization-${index}`)
}

function getStages(stage: StressStage): Array<Exclude<StressStage, 'both'>> {
  if (stage === 'both') return ['vision', 'enrichment', 'categorization']
  return [stage]
}

export function parseStressConfigFromEnv(
  env: StressEnv = process.env,
): OllamaStressConfig {
  return {
    enabled: parseBooleanFlag(env.OLLAMA_STRESS),
    baseUrl: sanitizeOllamaBaseUrl(env.OLLAMA_STRESS_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL),
    model: sanitizeOllamaVisionModel(env.OLLAMA_STRESS_MODEL ?? DEFAULT_OLLAMA_VISION_MODEL),
    stage: parseStage(env.OLLAMA_STRESS_STAGE),
    concurrency: parseConcurrencyList(env.OLLAMA_STRESS_CONCURRENCY),
    timeoutMs: parseInteger(env.OLLAMA_STRESS_TIMEOUT_MS, 60_000),
    requestsPerSweep: env.OLLAMA_STRESS_REQUESTS ? parseInteger(env.OLLAMA_STRESS_REQUESTS, 1) : undefined,
  }
}

export async function runConfiguredOllamaStress(
  config: OllamaStressConfig,
): Promise<OllamaStressResult[]> {
  const results: OllamaStressResult[] = []

  for (const stage of getStages(config.stage)) {
    for (const concurrency of config.concurrency) {
      const requested = config.requestsPerSweep ?? concurrency
      const summary = await runStressSweep({
        concurrency,
        count: requested,
        timeoutMs: config.timeoutMs,
        runTask: (index, signal) => {
          if (stage === 'vision') {
            return runVisionTask(config, signal)
          }
          if (stage === 'enrichment') {
            return runEnrichmentTask(config, index, signal)
          }
          return runCategorizationTask(config, index, signal)
        },
      })

      const result: OllamaStressResult = { stage, ...summary }
      console.info(JSON.stringify(result, null, 2))
      results.push(result)
    }
  }

  return results
}
