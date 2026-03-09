# Import Restore Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let `/import` restore previously exported Siftly JSON as canonical bookmark state, merge by `tweetId`, and offer preprocessing only for missing stages on the imported bookmark set.

**Architecture:** Add import-format detection and restore/upsert helpers behind the existing `/api/import` route so raw X exports and Siftly exports share one upload flow. Compute stage-specific missing-work summaries from stored bookmark/media/category state, then extend `/api/categorize` and the `/import` UI to run either missing-only stages or a force reprocess for just the imported bookmarks.

**Tech Stack:** TypeScript, Next.js route handlers, Prisma, React, node:test via `tsx`

---

### Task 1: Lock Siftly export import-shape detection with failing tests

**Files:**
- Create: `tests/import-export-shape.test.ts`
- Create: `lib/import-export-shape.ts`
- Modify: `lib/exporter.ts`

**Step 1: Write the failing test**

Add tests for:
- detecting current Siftly JSON export payloads from `serializeBookmarkForJson()`
- rejecting raw X/bookmarklet export payloads as restore format
- normalizing exported rows into a restore payload with:
  - bookmark base fields
  - parsed preprocessing fields
  - media rows
  - categories with confidence

Use fixtures shaped like:

```ts
const payload = {
  bookmarks: [{
    tweetId: '123',
    text: 'restored bookmark',
    authorHandle: 'viperr',
    authorName: 'Viperr',
    source: 'bookmark',
    importedAt: '2026-03-09T11:00:00.000Z',
    enrichedAt: '2026-03-09T12:00:00.000Z',
    rawJson: '{"tweet":"raw"}',
    semanticTags: ['react hooks'],
    entities: { hashtags: ['ai'] },
    enrichmentMeta: { sentiment: 'positive' },
    categories: [{ name: 'AI Resources', slug: 'ai-resources', color: '#fff', confidence: 0.9 }],
    mediaItems: [{ type: 'photo', url: 'https://cdn.example.com/1.png', imageTags: { scene: 'desk' } }],
  }],
}
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/import-export-shape.test.ts`
Expected: FAIL because `lib/import-export-shape.ts` does not exist yet

**Step 3: Write minimal implementation**

Create `lib/import-export-shape.ts` with:
- `isSiftlyJsonExport(parsed: unknown): boolean`
- `normalizeSiftlyImportPayload(parsed: unknown): RestoredBookmark[]`
- JSON/date parsing helpers that preserve `null` and reject malformed restore rows

Keep the module pure so route logic can reuse it without Prisma setup.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/import-export-shape.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/import-export-shape.test.ts lib/import-export-shape.ts
git commit -m "test: define restore import shape" -m "exports reveal form\nrestore payload learns each field\nroutes gain a contract"
```

### Task 2: Lock missing-stage detection with failing tests

**Files:**
- Create: `tests/import-missing-stages.test.ts`
- Create: `lib/import-missing-stages.ts`

**Step 1: Write the failing test**

Add tests covering:
- fully restored bookmark reports no missing stages
- bookmark with empty `entities` reports `entities`
- bookmark with one untagged media item reports `vision`
- bookmark missing `semanticTags`, `enrichedAt`, or `enrichmentMeta` reports `enrichment`
- bookmark with zero category joins reports `categorization`
- aggregate summary returns stage counts plus bookmark IDs for each stage

Use row fixtures shaped like:

```ts
const row = {
  id: 'bm-1',
  entities: null,
  semanticTags: '["react hooks"]',
  enrichmentMeta: '{"sentiment":"positive"}',
  enrichedAt: new Date('2026-03-09T12:00:00.000Z'),
  categories: [{ categoryId: 'cat-1' }],
  mediaItems: [{ type: 'photo', imageTags: null }],
}
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/import-missing-stages.test.ts`
Expected: FAIL because the missing-stage helper does not exist yet

**Step 3: Write minimal implementation**

Create `lib/import-missing-stages.ts` with:
- validation helpers for stored JSON strings
- `getMissingStagesForBookmark(row)`
- `summarizeMissingStages(rows)`

Return both counts and bookmark ID lists so `/api/import` and `/api/categorize` can share the result.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/import-missing-stages.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/import-missing-stages.test.ts lib/import-missing-stages.ts
git commit -m "test: map missing preprocessing stages" -m "partial backups speak\nempty fields expose what remains\nnext work stays scoped tight"
```

### Task 3: Add failing route tests for restore import and merge-overwrite behavior

**Files:**
- Create: `tests/import-route.test.ts`
- Modify: `app/api/import/route.ts`
- Modify: `lib/parser.ts`
- Modify: `lib/db.ts` if lightweight test injection is needed

**Step 1: Write the failing test**

Add route-focused tests that exercise the handler with:
- raw export upload still returning `imported` and `skipped`
- Siftly export upload creating a fully restored bookmark
- Siftly export upload overwriting an existing bookmark by `tweetId`
- Siftly export upload returning:
  - `imported`
  - `updated`
  - `skipped`
  - `total`
  - `importedBookmarkIds`
  - `missing`

If direct Prisma integration is too heavy for `node:test`, extract import persistence into a pure-ish helper module and test that module instead of the route shell.

Use assertions like:

```ts
assert.equal(result.updated, 1)
assert.deepEqual(result.missing, {
  entities: 0,
  vision: 1,
  enrichment: 0,
  categorization: 0,
})
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/import-route.test.ts`
Expected: FAIL because the route cannot yet restore Siftly exports or return the richer summary

**Step 3: Write minimal implementation**

Refactor import logic into helpers that:
- detect raw export versus Siftly export
- upsert bookmarks by `tweetId`
- replace category joins from the imported export
- reconcile media rows by `url` plus `type`
- preserve raw import behavior for X exports
- compute `missing` summary for the affected bookmark set

Keep the route response backward-compatible by still returning `count`/`imported` for callers that only read totals.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/import-route.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/import-route.test.ts app/api/import/route.ts lib/parser.ts lib/import-export-shape.ts lib/import-missing-stages.ts
git commit -m "feat: restore exported bookmark state" -m "saved data returns\nexisting rows accept new truth\nimports become backups"
```

### Task 4: Add failing pipeline tests for scoped missing-only execution

**Files:**
- Create: `tests/categorize-scope.test.ts`
- Modify: `app/api/categorize/route.ts`
- Modify: `lib/import-missing-stages.ts`

**Step 1: Write the failing test**

Add tests for request parsing and stage selection:
- default call with empty body keeps existing behavior
- `{ bookmarkIds, stages: ['entities', 'vision'] }` restricts the run to those stages
- `{ bookmarkIds, force: true }` reprocesses all stages for only those bookmarks
- missing-only requests do not enqueue categorization for bookmarks that already have categories

Prefer testing extracted stage-planning helpers if the full route is awkward to instantiate.

Use fixtures/assertions like:

```ts
assert.deepEqual(plan.stageOrder, ['entities', 'parallel'])
assert.deepEqual(plan.bookmarkIds, ['bm-1', 'bm-2'])
assert.equal(plan.force, false)
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/categorize-scope.test.ts`
Expected: FAIL because scoped stage planning does not exist yet

**Step 3: Write minimal implementation**

Extract request parsing / execution planning from `app/api/categorize/route.ts` into a small helper if needed, then:
- accept optional `stages`
- accept imported bookmark scopes without breaking existing callers
- skip already restored stages unless `force` is true

Preserve the current global-state progress model.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/categorize-scope.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/categorize-scope.test.ts app/api/categorize/route.ts
git commit -m "feat: scope import preprocessing runs" -m "stage work narrows down\nrestored rows avoid wasteful loops\nforced runs still go deep"
```

### Task 5: Add failing UI tests for import result decisions, then wire `/import`

**Files:**
- Create: `tests/import-ui-state.test.ts`
- Create: `lib/import-ui-state.ts`
- Modify: `app/import/page.tsx`

**Step 1: Write the failing test**

Add tests for a pure UI-state helper that decides:
- whether to show `Process missing data`
- whether to show `Reprocess all imported bookmarks`
- whether to skip step 3 because nothing is missing
- summary copy for imported versus updated bookmark counts

Use cases like:

```ts
assert.equal(getImportFollowupState({
  imported: 5,
  updated: 2,
  missing: { entities: 0, vision: 0, enrichment: 0, categorization: 0 },
}).mode, 'complete')
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/import-ui-state.test.ts`
Expected: FAIL because the helper does not exist yet

**Step 3: Write minimal implementation**

Create `lib/import-ui-state.ts`, then update `app/import/page.tsx` to:
- mention both raw exports and Siftly JSON exports in step 1 copy
- store `updated`, `importedBookmarkIds`, and `missing` from the import response
- default the step-3 CTA to missing-only processing
- add a secondary `Reprocess all imported bookmarks` action
- show a completion state when nothing is missing

Keep the current uncategorized banner behavior for non-import flows.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/import-ui-state.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/import-ui-state.test.ts lib/import-ui-state.ts app/import/page.tsx
git commit -m "feat: guide restore follow-up processing" -m "imports tell what lacks\none path runs only what remains\nfull resets stay clear"
```

### Task 6: Verify the integrated flow

**Files:**
- None

**Step 1: Run focused tests**

Run:
- `node --import tsx --test tests/import-export-shape.test.ts`
- `node --import tsx --test tests/import-missing-stages.test.ts`
- `node --import tsx --test tests/import-route.test.ts`
- `node --import tsx --test tests/categorize-scope.test.ts`
- `node --import tsx --test tests/import-ui-state.test.ts`

Expected: PASS

**Step 2: Run existing regression tests**

Run:
- `node --import tsx --test tests/exporter.test.ts`
- `node --import tsx --test tests/categorization-provider.test.ts`
- `node --import tsx --test tests/semantic-enrichment-provider.test.ts`

Expected: PASS

**Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Run production build**

Run: `npm run build`
Expected: PASS

**Step 5: Manual verification**

Check:
- raw bookmarklet export still imports normally
- fully processed Siftly JSON import restores categories/tags/media analysis and offers no redundant processing
- partially processed Siftly JSON import reports only the missing stages
- importing the same Siftly JSON over existing bookmarks overwrites prior preprocessing state
