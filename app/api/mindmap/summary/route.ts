import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { summarizeMindmapCategorization } from '@/lib/mindmap-categorization-progress'

export async function GET(): Promise<NextResponse> {
  try {
    const bookmarks = await prisma.bookmark.findMany({
      orderBy: [
        { importedAt: 'asc' },
        { id: 'asc' },
      ],
      select: {
        id: true,
        categories: {
          select: { categoryId: true },
          take: 1,
        },
      },
    })

    return NextResponse.json(
      summarizeMindmapCategorization(
        bookmarks.map((bookmark) => ({
          id: bookmark.id,
          categorized: bookmark.categories.length > 0,
        })),
      ),
    )
  } catch (err) {
    console.error('Mindmap summary fetch error:', err)
    return NextResponse.json(
      { error: `Failed to fetch mindmap summary: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }
}
