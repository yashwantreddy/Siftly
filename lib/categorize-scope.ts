import {
  getMissingStagesForBookmark,
  type BookmarkStageRow,
} from '@/lib/import-missing-stages'

export type RequestedPipelineStage = 'entities' | 'vision' | 'enrichment' | 'categorize'

export interface ParsedCategorizeRequest {
  bookmarkIds: string[]
  apiKey?: string
  force: boolean
  stages?: RequestedPipelineStage[]
}

export interface StageSelection {
  entities: boolean
  vision: boolean
  enrichment: boolean
  categorize: boolean
}

const ALL_STAGES: RequestedPipelineStage[] = ['entities', 'vision', 'enrichment', 'categorize']

function isRequestedStage(value: unknown): value is RequestedPipelineStage {
  return value === 'entities' || value === 'vision' || value === 'enrichment' || value === 'categorize'
}

export function parseCategorizeRequestBody(text: string): ParsedCategorizeRequest {
  if (!text.trim()) {
    return {
      bookmarkIds: [],
      apiKey: undefined,
      force: false,
      stages: undefined,
    }
  }

  const parsed = JSON.parse(text) as Record<string, unknown>

  return {
    bookmarkIds: Array.isArray(parsed.bookmarkIds)
      ? parsed.bookmarkIds.filter((id): id is string => typeof id === 'string')
      : [],
    apiKey: typeof parsed.apiKey === 'string' && parsed.apiKey.trim() !== ''
      ? parsed.apiKey.trim()
      : undefined,
    force: parsed.force === true,
    stages: Array.isArray(parsed.stages)
      ? parsed.stages.filter(isRequestedStage)
      : undefined,
  }
}

export function buildCategorizeStageSelection(
  requestedStages: RequestedPipelineStage[] | undefined,
  force: boolean,
): StageSelection {
  if (force || !requestedStages || requestedStages.length === 0) {
    return {
      entities: true,
      vision: true,
      enrichment: true,
      categorize: true,
    }
  }

  const requested = new Set(requestedStages)

  return {
    entities: requested.has('entities'),
    vision: requested.has('vision'),
    enrichment: requested.has('enrichment'),
    categorize: requested.has('categorize'),
  }
}

export function getBookmarkStageWork(
  row: BookmarkStageRow,
  selection: StageSelection,
  force: boolean,
): Omit<StageSelection, 'entities'> {
  if (force) {
    return {
      vision: selection.vision,
      enrichment: selection.enrichment,
      categorize: selection.categorize,
    }
  }

  const missing = new Set(getMissingStagesForBookmark(row))

  return {
    vision: selection.vision && missing.has('vision'),
    enrichment: selection.enrichment && missing.has('enrichment'),
    categorize: selection.categorize && missing.has('categorization'),
  }
}

export function hasParallelStage(selection: StageSelection): boolean {
  return selection.vision || selection.enrichment || selection.categorize
}

export function normalizeRequestedStages(
  stages: RequestedPipelineStage[] | undefined,
  force: boolean,
): RequestedPipelineStage[] {
  return force || !stages || stages.length === 0 ? ALL_STAGES : stages
}
