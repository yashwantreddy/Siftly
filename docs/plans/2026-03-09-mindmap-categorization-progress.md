# Mindmap Categorization Progress Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let the mindmap screen prove categorization works by running the real pipeline on the first bookmark, then guide the user through categorizing the rest with durable progress feedback.

**Architecture:** Keep `/api/categorize` as the only execution path and add a small server-side summary helper that computes mindmap categorization status from real bookmark/category data. The mindmap page will use that summary to render either a proof-first empty state or an in-map progress panel, and will call the existing pipeline with explicit bookmark scopes for the first bookmark and remaining uncategorized bookmarks.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, SQLite, Node test runner, React client components

---

### Task 1: Add summary/scoping tests

**Files:**
- Create: `tests/mindmap-categorization-progress.test.ts`
- Modify: `tests/categorize-scope.test.ts`
- Test: `tests/mindmap-categorization-progress.test.ts`
- Test: `tests/categorize-scope.test.ts`

**Step 1: Write the failing tests**

Add helper tests that cover:
- picking the first bookmark deterministically from ordered bookmark ids
- deriving the remaining uncategorized bookmark ids while excluding already categorized bookmarks
- computing categorized, remaining, and percent progress from total bookmarks plus categorized bookmark ids
- preserving current request parsing behavior when `bookmarkIds` is passed

**Step 2: Run tests to verify they fail**

Run: `node --test tests/categorize-scope.test.ts tests/mindmap-categorization-progress.test.ts`
Expected: FAIL because the new helper module/functions do not exist yet.

**Step 3: Write minimal implementation**

Create a focused helper module for mindmap categorization summary/scoping and extend existing scope tests only where current behavior is part of the new feature.

**Step 4: Run tests to verify they pass**

Run: `node --test tests/categorize-scope.test.ts tests/mindmap-categorization-progress.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/categorize-scope.test.ts tests/mindmap-categorization-progress.test.ts lib/mindmap-categorization-progress.ts
git commit -m "test: cover mindmap categorization progress"
```

### Task 2: Add backend mindmap summary support

**Files:**
- Create: `lib/mindmap-categorization-progress.ts`
- Modify: `app/api/mindmap/route.ts`
- Modify: `app/api/stats/route.ts`
- Test: `tests/mindmap-categorization-progress.test.ts`

**Step 1: Write the failing test**

Add assertions for the exported helper that the route layer will use to return:
- first bookmark id
- categorized count
- remaining count
- percent complete

**Step 2: Run test to verify it fails**

Run: `node --test tests/mindmap-categorization-progress.test.ts`
Expected: FAIL because helper exports are missing or incomplete.

**Step 3: Write minimal implementation**

Implement a helper that:
- treats a bookmark as categorized only when it has at least one category assignment
- computes a stable first bookmark from the earliest ordered bookmark row used by the page
- returns ids/counts the UI can consume without duplicating DB logic

Wire the API layer to expose this summary to the mindmap page.

**Step 4: Run test to verify it passes**

Run: `node --test tests/mindmap-categorization-progress.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/mindmap-categorization-progress.ts app/api/mindmap/route.ts app/api/stats/route.ts tests/mindmap-categorization-progress.test.ts
git commit -m "feat: add mindmap categorization summary"
```

### Task 3: Update mindmap actions and progress UI

**Files:**
- Modify: `app/mindmap/page.tsx`
- Test: `tests/mindmap-categorization-progress.test.ts`

**Step 1: Write the failing test**

Add helper-level expectations for the UI state inputs if needed, then identify the specific rendering/data transitions the page must support:
- empty state shows `Categorize first bookmark`
- empty state also shows `Categorize rest of bookmarks`
- active/progress state shows categorized, remaining, and percent complete

**Step 2: Run test to verify it fails**

Run: `node --test tests/mindmap-categorization-progress.test.ts`
Expected: FAIL if any new helper state for the UI has not been implemented yet.

**Step 3: Write minimal implementation**

Update the page to:
- fetch the new summary
- trigger `/api/categorize` with only the first bookmark id for the proof step
- trigger `/api/categorize` with remaining uncategorized ids for the rest step
- render a progress bar and counts on both the empty state and populated map view
- keep live pipeline stage messaging when a run is active

**Step 4: Run test to verify it passes**

Run: `node --test tests/mindmap-categorization-progress.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add app/mindmap/page.tsx tests/mindmap-categorization-progress.test.ts
git commit -m "feat: add mindmap categorization controls"
```

### Task 4: Verify end-to-end behavior

**Files:**
- Modify: none unless verification reveals a defect

**Step 1: Run focused automated verification**

Run: `node --test tests/categorize-scope.test.ts tests/mindmap-categorization-progress.test.ts`
Expected: PASS

**Step 2: Run type-check verification**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Run production build verification**

Run: `npm run build`
Expected: PASS

**Step 4: Fix any failures and re-run**

Address only the issues introduced by this feature, then repeat the failed verification command until clean.

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: verify mindmap categorization flow"
```
