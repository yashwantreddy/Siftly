# Import Restore Design

## Goal

Allow the `/import` flow to accept Siftly JSON exports produced by Settings -> Data Management -> Export as JSON, restore all included preprocessing state as canonical data, and offer selective follow-up preprocessing only for bookmarks that still have missing stages.

## Decisions

- Keep `/import` as the single upload entry point for both raw X/Twitter exports and Siftly JSON exports.
- Detect import format server-side instead of adding a separate restore UI.
- Treat Siftly JSON exports as canonical snapshots:
  - create missing bookmarks
  - merge existing bookmarks by `tweetId`
  - overwrite stored preprocessing state with the imported export
- Restore all included preprocessing fields exactly as exported:
  - `semanticTags`
  - `entities`
  - `enrichmentMeta`
  - `enrichedAt`
  - category assignments plus confidence
  - media `imageTags`, `thumbnailUrl`, and `localPath`
- Replace existing bookmark categories with the imported category set so the export remains the source of truth.
- Reconcile media items by stable media identity (`url` plus `type`) so existing rows can be updated instead of duplicated.
- After import, compute stage-specific missing-work counts so the UI can default to processing only incomplete bookmarks.

## Import Semantics

### Raw X/Twitter export

Keep the current behavior for bookmarklet/console/raw JSON imports:

- parse tweet data into base bookmark records
- create or skip/merge rows according to the existing import behavior updated for the new upsert model
- do not fabricate preprocessing fields

### Siftly JSON export

Accept the current export shape from `lib/exporter.ts` and restore it directly:

- base bookmark fields:
  - `tweetId`
  - `text`
  - `authorHandle`
  - `authorName`
  - `source`
  - `tweetCreatedAt`
  - `importedAt`
  - `rawJson`
- preprocessing fields:
  - `semanticTags`
  - `entities`
  - `enrichmentMeta`
  - `enrichedAt`
- relations:
  - categories with `name`, `slug`, `color`, `confidence`
  - media items with `type`, `url`, `thumbnailUrl`, `localPath`, `imageTags`

For existing bookmarks, the imported snapshot overwrites the local preprocessing state. This makes JSON export/import suitable for backup, migration, and workspace restore.

## Runtime Design

Introduce shared import-shape helpers so export/import stay aligned:

- detect whether uploaded JSON is a raw export or a Siftly export
- normalize Siftly export rows into a server-side restore payload
- compute missing preprocessing stages from restored bookmark state

Extend the import route so it can:

- parse the uploaded JSON
- choose the correct import path
- upsert bookmarks by `tweetId`
- reconcile media rows
- replace category joins
- return a richer summary:
  - `imported`
  - `updated`
  - `skipped`
  - `total`
  - `importedBookmarkIds`
  - `missing`

`missing` should report stage counts for:

- `entities`
- `vision`
- `enrichment`
- `categorization`

## Selective Preprocessing Rules

Stage eligibility should be derived from stored fields, not from import source:

- `needsEntities`
  - `entities` is missing, empty, or invalid
- `needsVision`
  - bookmark has at least one photo/video/gif media item whose `imageTags` are missing, empty, or invalid
- `needsEnrichment`
  - `semanticTags` missing or invalid
  - or `enrichedAt` missing
  - or `enrichmentMeta` missing or invalid
- `needsCategorization`
  - bookmark has no category assignments

The categorization pipeline should accept scoped stage execution so `/import` can request:

- process only missing stages for the imported bookmark IDs
- or reprocess all stages for the imported bookmark IDs

Existing callers should keep current behavior if no scoped stages are provided.

## UI Design

Update `/import` copy to say the uploader accepts:

- raw X/Twitter exports
- Siftly JSON exports

After import:

- step 2 shows whether rows were newly imported or updated from an exported backup
- step 3 displays missing-stage counts for the uploaded bookmark set
- default CTA:
  - `Process missing data`
- secondary CTA:
  - `Reprocess all imported bookmarks`
- if nothing is missing, show a completion state instead of prompting for redundant processing

## Error Handling

- Invalid or unsupported JSON shape should fail with a clear import error before any partial persistence.
- Category restore should upsert missing categories by slug/name before writing joins.
- Media reconciliation should avoid duplicate rows when a bookmark already contains the same exported asset.
- Missing preprocessing metadata in partial exports should not block import; those bookmarks simply appear in the relevant `missing` counts.

## Testing

- Add parser/import tests for:
  - raw export detection
  - Siftly export detection
  - full restore payload parsing
- Add route tests for:
  - restoring a fully preprocessed export
  - overwriting an existing bookmark from imported JSON
  - reporting per-stage missing counts for partial exports
- Add pipeline tests for scoped stage execution so restored stages are skipped unless forced.

## Verification

Run:

- `node --import tsx --test tests/...`
- `npx tsc --noEmit`
- `npm run build`

Manual checks:

- upload a fully processed Siftly JSON export and confirm import completes without offering unnecessary preprocessing
- upload a partial Siftly JSON export and confirm `/import` offers only the missing stages
- upload a Siftly JSON export over existing bookmarks and confirm local preprocessing state is overwritten by the imported snapshot
