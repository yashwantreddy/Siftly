export interface MindmapCategorizationBookmark {
  id: string
  categorized: boolean
}

export interface MindmapCategorizationSummary {
  totalBookmarks: number
  categorizedCount: number
  remainingCount: number
  progressPercent: number
  firstBookmarkId: string | null
  firstBookmarkCategorized: boolean
  remainingBookmarkIds: string[]
  restBookmarkIds: string[]
}

export function summarizeMindmapCategorization(
  bookmarks: MindmapCategorizationBookmark[],
): MindmapCategorizationSummary {
  const totalBookmarks = bookmarks.length
  const categorizedCount = bookmarks.filter((bookmark) => bookmark.categorized).length
  const remainingBookmarkIds = bookmarks
    .filter((bookmark) => !bookmark.categorized)
    .map((bookmark) => bookmark.id)
  const remainingCount = remainingBookmarkIds.length
  const firstBookmarkId = bookmarks[0]?.id ?? null
  const firstBookmarkCategorized = bookmarks[0]?.categorized ?? false
  const restBookmarkIds = remainingBookmarkIds.filter((bookmarkId) => bookmarkId !== firstBookmarkId)

  return {
    totalBookmarks,
    categorizedCount,
    remainingCount,
    progressPercent: totalBookmarks === 0 ? 0 : Math.round((categorizedCount / totalBookmarks) * 100),
    firstBookmarkId,
    firstBookmarkCategorized,
    remainingBookmarkIds,
    restBookmarkIds,
  }
}
