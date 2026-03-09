interface MissingCounts {
  entities: number
  vision: number
  enrichment: number
  categorization: number
}

interface ImportStateResult {
  imported: number
  updated?: number
  skipped: number
  total: number
  importedBookmarkIds?: string[]
  missing?: MissingCounts
}

export interface ImportFollowupState {
  mode: 'complete' | 'process-missing' | 'process-all'
  primaryLabel: string
  shouldAutoStart: boolean
  missingItems: string[]
  hasImportedScope: boolean
}

function formatMissingItem(count: number, singular: string, plural: string): string | null {
  if (count === 0) return null
  return `${count} ${count === 1 ? singular : plural}`
}

export function formatImportResultSummary(result: ImportStateResult): string {
  const updated = result.updated ?? 0
  return `${result.imported} imported, ${updated} updated, ${result.skipped} skipped`
}

export function getImportFollowupState(result: ImportStateResult | null): ImportFollowupState {
  const hasImportedScope = Boolean(result?.importedBookmarkIds && result.importedBookmarkIds.length > 0)
  const missing = result?.missing

  if (!hasImportedScope || !missing) {
    return {
      mode: 'process-all',
      primaryLabel: 'Start preprocessing',
      shouldAutoStart: true,
      missingItems: [],
      hasImportedScope: false,
    }
  }

  const missingItems = [
    formatMissingItem(missing.entities, 'needs entities', 'need entities'),
    formatMissingItem(missing.vision, 'needs image analysis', 'need image analysis'),
    formatMissingItem(missing.enrichment, 'needs semantic enrichment', 'need semantic enrichment'),
    formatMissingItem(missing.categorization, 'needs categorization', 'need categorization'),
  ].filter((item): item is string => item !== null)

  if (missingItems.length === 0) {
    return {
      mode: 'complete',
      primaryLabel: 'View imported bookmarks',
      shouldAutoStart: false,
      missingItems: [],
      hasImportedScope: true,
    }
  }

  return {
    mode: 'process-missing',
    primaryLabel: 'Process missing data',
    shouldAutoStart: false,
    missingItems,
    hasImportedScope: true,
  }
}
