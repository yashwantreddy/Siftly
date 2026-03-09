import type { PrismaClient } from '@/app/generated/prisma/client'
import type { RestoredBookmark } from '@/lib/import-export-shape'
import type { ImportRepository } from '@/lib/import-service'
import type { ParsedBookmark } from '@/lib/parser'

function toStoredJson(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value)
}

function toStoredRawJson(value: string | null): string {
  return value ?? '{}'
}

export function createPrismaImportRepository(prisma: PrismaClient): ImportRepository {
  return {
    async findBookmarkByTweetId(tweetId: string) {
      return prisma.bookmark.findUnique({
        where: { tweetId },
        select: { id: true },
      })
    },

    async createRawBookmark(bookmark: ParsedBookmark, source: 'bookmark' | 'like') {
      const created = await prisma.bookmark.create({
        data: {
          tweetId: bookmark.tweetId,
          text: bookmark.text,
          authorHandle: bookmark.authorHandle,
          authorName: bookmark.authorName,
          tweetCreatedAt: bookmark.tweetCreatedAt,
          rawJson: bookmark.rawJson,
          source,
        },
        select: { id: true },
      })

      if (bookmark.media.length > 0) {
        await prisma.mediaItem.createMany({
          data: bookmark.media.map((media) => ({
            bookmarkId: created.id,
            type: media.type,
            url: media.url,
            thumbnailUrl: media.thumbnailUrl ?? null,
          })),
        })
      }

      return { id: created.id, created: true }
    },

    async upsertRestoredBookmark(bookmark: RestoredBookmark) {
      const existing = await prisma.bookmark.findUnique({
        where: { tweetId: bookmark.tweetId },
        select: { id: true },
      })

      const data = {
        tweetId: bookmark.tweetId,
        text: bookmark.text,
        authorHandle: bookmark.authorHandle,
        authorName: bookmark.authorName,
        source: bookmark.source,
        tweetCreatedAt: bookmark.tweetCreatedAt,
        importedAt: bookmark.importedAt,
        rawJson: toStoredRawJson(bookmark.rawJson),
        semanticTags: JSON.stringify(bookmark.semanticTags),
        entities: toStoredJson(bookmark.entities),
        enrichmentMeta: toStoredJson(bookmark.enrichmentMeta),
        enrichedAt: bookmark.enrichedAt,
      }

      let bookmarkId: string

      if (existing) {
        bookmarkId = existing.id
        await prisma.bookmark.update({
          where: { id: bookmarkId },
          data,
        })
      } else {
        const created = await prisma.bookmark.create({
          data,
          select: { id: true },
        })
        bookmarkId = created.id
      }

      await prisma.bookmarkCategory.deleteMany({
        where: { bookmarkId },
      })

      const categoryIds: string[] = []
      for (const category of bookmark.categories) {
        const upserted = await prisma.category.upsert({
          where: { slug: category.slug },
          update: {
            name: category.name,
            color: category.color,
          },
          create: {
            name: category.name,
            slug: category.slug,
            color: category.color,
          },
          select: { id: true },
        })
        categoryIds.push(upserted.id)
      }

      if (bookmark.categories.length > 0) {
        await prisma.bookmarkCategory.createMany({
          data: bookmark.categories.map((category, index) => ({
            bookmarkId,
            categoryId: categoryIds[index]!,
            confidence: category.confidence ?? 1,
          })),
        })
      }

      await prisma.mediaItem.deleteMany({
        where: { bookmarkId },
      })

      if (bookmark.mediaItems.length > 0) {
        await prisma.mediaItem.createMany({
          data: bookmark.mediaItems.map((media) => ({
            bookmarkId,
            type: media.type,
            url: media.url,
            thumbnailUrl: media.thumbnailUrl,
            localPath: media.localPath,
            imageTags: toStoredJson(media.imageTags),
          })),
        })
      }

      return {
        id: bookmarkId,
        created: !existing,
        updated: Boolean(existing),
      }
    },

    async getStageRows(bookmarkIds: string[]) {
      return prisma.bookmark.findMany({
        where: { id: { in: bookmarkIds } },
        select: {
          id: true,
          entities: true,
          semanticTags: true,
          enrichmentMeta: true,
          enrichedAt: true,
          categories: {
            select: { categoryId: true },
          },
          mediaItems: {
            select: {
              type: true,
              imageTags: true,
            },
          },
        },
      })
    },
  }
}
