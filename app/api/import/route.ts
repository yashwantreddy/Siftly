import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { createPrismaImportRepository } from '@/lib/import-prisma-repository'
import { isSiftlyJsonExport, normalizeSiftlyImportPayload } from '@/lib/import-export-shape'
import { importRawBookmarks, importRestoredBookmarks } from '@/lib/import-service'
import { parseBookmarksJson } from '@/lib/parser'

export async function POST(request: NextRequest): Promise<NextResponse> {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Failed to parse form data' }, { status: 400 })
  }

  const sourceParam = (formData.get('source') as string | null)?.trim()
  const file = formData.get('file')
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json(
      { error: 'Missing required field: file' },
      { status: 400 }
    )
  }

  const filename =
    file instanceof File ? file.name : 'bookmarks.json'

  let jsonString: string
  try {
    jsonString = await file.text()
  } catch {
    return NextResponse.json({ error: 'Failed to read file content' }, { status: 400 })
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(jsonString)
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to parse bookmarks JSON: ${err instanceof Error ? err.message : String(err)}` },
      { status: 422 }
    )
  }

  // Create an import job to track progress
  const importJob = await prisma.importJob.create({
    data: {
      filename,
      status: 'processing',
      totalCount: 0,
      processedCount: 0,
    },
  })

  const repository = createPrismaImportRepository(prisma)
  const isRestoreImport = isSiftlyJsonExport(parsedJson)

  let rawBookmarks = null
  let restoredBookmarks = null
  try {
    if (isRestoreImport) {
      restoredBookmarks = normalizeSiftlyImportPayload(parsedJson)
    } else {
      rawBookmarks = parseBookmarksJson(jsonString)
    }
  } catch (err) {
    await prisma.importJob.update({
      where: { id: importJob.id },
      data: {
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    })
    return NextResponse.json(
      { error: `Failed to parse bookmarks JSON: ${err instanceof Error ? err.message : String(err)}` },
      { status: 422 }
    )
  }

  // Determine source: formData param > JSON field > default "bookmark"
  let jsonSource: string | undefined
  const parsedRecord = typeof parsedJson === 'object' && parsedJson !== null
    ? parsedJson as { source?: unknown }
    : null
  if (typeof parsedRecord?.source === 'string') jsonSource = parsedRecord.source
  const source = (sourceParam === 'like' || sourceParam === 'bookmark')
    ? sourceParam
    : (jsonSource === 'like' ? 'like' : 'bookmark')

  await prisma.importJob.update({
    where: { id: importJob.id },
    data: { totalCount: isRestoreImport ? restoredBookmarks?.length ?? 0 : rawBookmarks?.length ?? 0 },
  })

  let result
  try {
    result = isRestoreImport
      ? await importRestoredBookmarks({
          bookmarks: restoredBookmarks ?? [],
          repository,
        })
      : await importRawBookmarks({
          bookmarks: rawBookmarks ?? [],
          source,
          repository,
        })
  } catch (err) {
    await prisma.importJob.update({
      where: { id: importJob.id },
      data: {
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    })

    return NextResponse.json(
      { error: `Failed to import bookmarks: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }

  await prisma.importJob.update({
    where: { id: importJob.id },
    data: {
      status: 'done',
      processedCount: result.imported + result.updated,
    },
  })

  return NextResponse.json({
    jobId: importJob.id,
    count: result.imported,
    imported: result.imported,
    updated: result.updated,
    skipped: result.skipped,
    total: result.total,
    importedBookmarkIds: result.importedBookmarkIds,
    missing: result.missing,
  })
}
