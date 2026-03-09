export type MissingStage = 'entities' | 'vision' | 'enrichment' | 'categorization'

export interface BookmarkStageRow {
  id: string
  entities: string | null
  semanticTags: string | null
  enrichmentMeta: string | null
  enrichedAt: Date | null
  categories: Array<unknown>
  mediaItems: Array<{
    type: string
    imageTags: string | null
  }>
}

interface MissingStageSummary {
  counts: Record<MissingStage, number>
  bookmarkIds: Record<MissingStage, string[]>
}

const MEDIA_TYPES_NEEDING_VISION = new Set(['photo', 'gif', 'video'])

function hasNonEmptyJsonObject(value: string | null): boolean {
  if (!value || value.trim() === '') return false

  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && Object.keys(parsed).length > 0
  } catch {
    return false
  }
}

function hasNonEmptyJsonArray(value: string | null): boolean {
  if (!value || value.trim() === '') return false

  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) && parsed.length > 0
  } catch {
    return false
  }
}

function hasVisionGap(mediaItems: BookmarkStageRow['mediaItems']): boolean {
  return mediaItems.some((media) => (
    MEDIA_TYPES_NEEDING_VISION.has(media.type) && !hasNonEmptyJsonObject(media.imageTags)
  ))
}

export function getMissingStagesForBookmark(row: BookmarkStageRow): MissingStage[] {
  const stages: MissingStage[] = []

  if (!hasNonEmptyJsonObject(row.entities)) {
    stages.push('entities')
  }

  if (hasVisionGap(row.mediaItems)) {
    stages.push('vision')
  }

  if (!hasNonEmptyJsonArray(row.semanticTags) || !hasNonEmptyJsonObject(row.enrichmentMeta) || row.enrichedAt === null) {
    stages.push('enrichment')
  }

  if (row.categories.length === 0) {
    stages.push('categorization')
  }

  return stages
}

export function summarizeMissingStages(rows: BookmarkStageRow[]): MissingStageSummary {
  const summary: MissingStageSummary = {
    counts: {
      entities: 0,
      vision: 0,
      enrichment: 0,
      categorization: 0,
    },
    bookmarkIds: {
      entities: [],
      vision: [],
      enrichment: [],
      categorization: [],
    },
  }

  for (const row of rows) {
    for (const stage of getMissingStagesForBookmark(row)) {
      summary.counts[stage] += 1
      summary.bookmarkIds[stage].push(row.id)
    }
  }

  return summary
}
