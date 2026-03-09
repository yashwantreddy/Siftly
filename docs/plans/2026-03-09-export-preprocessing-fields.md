# Export Preprocessing Fields Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Include preprocessing output in the default CSV and JSON bookmark exports, with CSV using spreadsheet-friendly flattened columns.

**Architecture:** Refactor the exporter around pure serialization helpers so tests can lock the output shape without mocking Prisma. JSON export will include parsed preprocessing structures directly. CSV export will keep current core fields, add entity/enrichment/category columns, and flatten vision fields for up to four media items with an overflow fallback column.

**Tech Stack:** TypeScript, node:test via `tsx`, Prisma, Next.js route handlers

---

### Task 1: Lock export shape with failing serializer tests

**Files:**
- Create: `tests/exporter.test.ts`
- Modify: `lib/exporter.ts`
- Test: `tests/exporter.test.ts`

**Step 1: Write the failing test**

Add tests covering:
- JSON export includes `semanticTags`, `enrichmentMeta`, `entities`, `enrichedAt`, `imageTags`, and category `confidence`
- CSV export headers include flattened entity/enrichment/category fields
- CSV export flattens vision fields into `media1_*` columns and preserves overflow in a fallback column

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/exporter.test.ts`
Expected: FAIL because serializer helpers do not exist yet

**Step 3: Write minimal implementation**

Create/export pure helpers in `lib/exporter.ts` for:
- parsing stored JSON safely
- building CSV headers
- converting a bookmark row into export-ready JSON
- converting a bookmark row into a flattened CSV row

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/exporter.test.ts`
Expected: PASS

### Task 2: Wire the real export functions to the new serializers

**Files:**
- Modify: `lib/exporter.ts`
- Test: `tests/exporter.test.ts`

**Step 1: Write the failing test**

Extend tests to assert:
- JSON output now serializes parsed preprocessing fields
- CSV output includes the new headers and flattened values in the generated output

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/exporter.test.ts`
Expected: FAIL on missing fields in CSV/JSON output

**Step 3: Write minimal implementation**

Update the exporter query row types and `exportAllBookmarksCsv()` / `exportBookmarksJson()` to use the new helpers.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/exporter.test.ts`
Expected: PASS

### Task 3: Verify full project consistency

**Files:**
- None

**Step 1: Run focused export tests**

Run: `node --import tsx --test tests/exporter.test.ts`
Expected: PASS

**Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS
