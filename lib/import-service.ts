import type { RestoredBookmark } from '@/lib/import-export-shape'
import { summarizeMissingStages, type BookmarkStageRow } from '@/lib/import-missing-stages'
import type { ParsedBookmark } from '@/lib/parser'

export interface ImportRepository {
  findBookmarkByTweetId(tweetId: string): Promise<{ id: string } | null>
  createRawBookmark(bookmark: ParsedBookmark, source: 'bookmark' | 'like'): Promise<{ id: string; created: boolean }>
  upsertRestoredBookmark(bookmark: RestoredBookmark): Promise<{ id: string; created: boolean; updated: boolean }>
  getStageRows(bookmarkIds: string[]): Promise<BookmarkStageRow[]>
}

interface RawImportInput {
  bookmarks: ParsedBookmark[]
  source: 'bookmark' | 'like'
  repository: ImportRepository
}

interface RestoredImportInput {
  bookmarks: RestoredBookmark[]
  repository: ImportRepository
}

interface MissingCounts {
  entities: number
  vision: number
  enrichment: number
  categorization: number
}

export interface ImportResult {
  imported: number
  updated: number
  skipped: number
  total: number
  importedBookmarkIds: string[]
  missing: MissingCounts
}

function emptyMissingCounts(): MissingCounts {
  return {
    entities: 0,
    vision: 0,
    enrichment: 0,
    categorization: 0,
  }
}

export async function importRawBookmarks({
  bookmarks,
  source,
  repository,
}: RawImportInput): Promise<ImportResult> {
  let imported = 0
  let skipped = 0
  const importedBookmarkIds: string[] = []

  for (const bookmark of bookmarks) {
    const existing = await repository.findBookmarkByTweetId(bookmark.tweetId)
    if (existing) {
      skipped += 1
      continue
    }

    const created = await repository.createRawBookmark(bookmark, source)
    imported += created.created ? 1 : 0
    importedBookmarkIds.push(created.id)
  }

  const stageRows = importedBookmarkIds.length > 0
    ? await repository.getStageRows(importedBookmarkIds)
    : []
  const summary = summarizeMissingStages(stageRows)

  return {
    imported,
    updated: 0,
    skipped,
    total: bookmarks.length,
    importedBookmarkIds,
    missing: summary.counts,
  }
}

export async function importRestoredBookmarks({
  bookmarks,
  repository,
}: RestoredImportInput): Promise<ImportResult> {
  let imported = 0
  let updated = 0
  const importedBookmarkIds: string[] = []

  for (const bookmark of bookmarks) {
    const result = await repository.upsertRestoredBookmark(bookmark)
    if (result.created) imported += 1
    if (result.updated) updated += 1
    importedBookmarkIds.push(result.id)
  }

  const stageRows = importedBookmarkIds.length > 0
    ? await repository.getStageRows(importedBookmarkIds)
    : []
  const summary = summarizeMissingStages(stageRows)

  return {
    imported,
    updated,
    skipped: 0,
    total: bookmarks.length,
    importedBookmarkIds,
    missing: importedBookmarkIds.length > 0 ? summary.counts : emptyMissingCounts(),
  }
}
