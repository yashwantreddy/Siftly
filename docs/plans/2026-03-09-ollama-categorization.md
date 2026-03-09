# Ollama Categorization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make categorization follow the shared preprocessing provider so Ollama can run image vision, semantic enrichment, and categorization end to end with the same shared model.

**Architecture:** Extract categorization prompt/parse/provider logic into a dedicated module, keep `categorizeBatch()` as the provider-aware entrypoint, and extend the existing shared preprocessing switch to cover categorization with no fallback when `ollama` is selected. Persistence stays unchanged, and AI search remains Anthropic-backed.

**Tech Stack:** Next.js App Router, TypeScript, node:test via `tsx`, Anthropic SDK, native `fetch`, Prisma/SQLite

---

### Task 1: Lock the categorization provider contract with failing tests

**Files:**
- Create: `tests/categorization-provider.test.ts`
- Test: `tests/categorization-provider.test.ts`

**Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  extractCanonicalCategorizationJson,
  getCategorizationTestPrompt,
  parseCategorizationResponse,
} from '../lib/categorization-provider'

test('parseCategorizationResponse keeps valid slugs and clamps confidence', () => {
  const rows = parseCategorizationResponse(
    '[{"tweetId":"1","assignments":[{"category":"ai-resources","confidence":1.5},{"category":"unknown","confidence":0.8}]}]',
    new Set(['ai-resources']),
  )

  assert.deepEqual(rows, [{
    tweetId: '1',
    assignments: [{ category: 'ai-resources', confidence: 1 }],
  }])
})

test('extractCanonicalCategorizationJson rejects missing assignments', () => {
  assert.throws(
    () => extractCanonicalCategorizationJson('[{"tweetId":"1"}]'),
    /missing required categorization fields/i,
  )
})

test('getCategorizationTestPrompt preserves tweetId and assignments schema', () => {
  const prompt = getCategorizationTestPrompt()
  assert.match(prompt, /"tweetId"/)
  assert.match(prompt, /"assignments"/)
})
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/categorization-provider.test.ts`
Expected: FAIL with `Cannot find module '../lib/categorization-provider'`

**Step 3: Write minimal implementation**

Create `lib/categorization-provider.ts` with:

- `CategoryAssignment` and `CategorizationResult` types
- `getCategorizationPrompt(...)`
- `getCategorizationTestPrompt()`
- `parseCategorizationResponse(text, validSlugs)`
- `extractCanonicalCategorizationJson(text)`

Implementation requirements:

- prompt content must match the current categorization schema and instructions
- parser must:
  - read a JSON array
  - require `tweetId` and `assignments`
  - clamp confidence to `0.5..1.0`
  - filter out invalid category slugs

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/categorization-provider.test.ts`
Expected: PASS with 3 passing tests

**Step 5: Commit**

```bash
git add tests/categorization-provider.test.ts lib/categorization-provider.ts
git commit -m "batch tags land
provider contract holds the shape
confidence stays bound"
```

### Task 2: Add Anthropic and Ollama categorization adapters

**Files:**
- Modify: `lib/categorization-provider.ts`
- Modify: `lib/categorizer.ts`
- Test: `tests/categorization-provider.test.ts`

**Step 1: Write the failing test**

Add tests for:

```ts
test('createOllamaCategorizationProvider parses message.content assignment arrays', async () => {
  const provider = createOllamaCategorizationProvider({
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3.5:9b',
    fetchImpl: async () => new Response(JSON.stringify({
      message: {
        content: '[{"tweetId":"1","assignments":[{"category":"ai-resources","confidence":0.92}]}]',
      },
    }), { status: 200 }),
  })

  const rows = await provider.categorize('[]', new Set(['ai-resources']))
  assert.equal(rows[0]?.tweetId, '1')
  assert.equal(rows[0]?.assignments[0]?.category, 'ai-resources')
})

test('createOllamaCategorizationProvider throws on malformed JSON', async () => {
  const provider = createOllamaCategorizationProvider({
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3.5:9b',
    fetchImpl: async () => new Response(JSON.stringify({
      message: { content: '{"not":"an-array"}' },
    }), { status: 200 }),
  })

  await assert.rejects(() => provider.categorize('[]', new Set(['ai-resources'])), /json array/i)
})
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/categorization-provider.test.ts`
Expected: FAIL because categorization provider factories do not exist yet

**Step 3: Write minimal implementation**

Extend `lib/categorization-provider.ts` with:

- `CategorizationProvider` interface
- `createAnthropicCategorizationProvider({ client, model })`
- `createOllamaCategorizationProvider({ baseUrl, model, fetchImpl })`

Implementation requirements:

- Anthropic adapter:
  - call `client.messages.create(...)`
  - parse through the shared categorization parser
- Ollama adapter:
  - call `POST ${baseUrl}/api/chat`
  - use the shared Ollama model
  - parse `message.content` or `response`
  - reject malformed arrays and provider errors with provider-specific messages

Then modify `lib/categorizer.ts`:

- remove in-file prompt/parser duplication
- import the shared categorization provider helpers
- when shared preprocessing provider is `ollama`, skip Claude CLI entirely
- when provider is `anthropic`, keep the current CLI-first / SDK-fallback path
- use the same `imageVisionProvider`, `ollamaBaseUrl`, and `ollamaVisionModel` getters already used by vision/enrichment

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/categorization-provider.test.ts`
Expected: PASS with Ollama categorization adapter coverage added

**Step 5: Commit**

```bash
git add lib/categorization-provider.ts lib/categorizer.ts tests/categorization-provider.test.ts
git commit -m "same switch rules
ollama now assigns the categories
no fallback escapes"
```

### Task 3: Extend shared preprocessing requirements through the pipeline

**Files:**
- Modify: `lib/semantic-enrichment-provider.ts`
- Modify: `app/api/categorize/route.ts`
- Test: `tests/semantic-enrichment-provider.test.ts`

**Step 1: Write the failing test**

Extend the existing pipeline requirement helper test:

```ts
test('pipeline AI requirements allow Ollama preprocessing without Anthropic for categorization', () => {
  assert.deepEqual(getPipelineAiRequirements('ollama'), {
    needsAnthropicForVision: false,
    needsAnthropicForEnrichment: false,
    needsAnthropicForCategorization: false,
  })
})
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/semantic-enrichment-provider.test.ts`
Expected: FAIL because categorization still requires Anthropic

**Step 3: Write minimal implementation**

Update `getPipelineAiRequirements()` in `lib/semantic-enrichment-provider.ts`:

```ts
return {
  needsAnthropicForVision: provider === 'anthropic',
  needsAnthropicForEnrichment: provider === 'anthropic',
  needsAnthropicForCategorization: provider === 'anthropic',
}
```

Then update `app/api/categorize/route.ts` so it:

- no longer warns that categorization will be skipped when provider is `ollama`
- only blocks the pipeline entirely when the selected provider is `anthropic` and Anthropic is unavailable
- allows all three preprocessing stages to run on Ollama without Anthropic
- preserves the existing batching and persistence flow

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/semantic-enrichment-provider.test.ts`
Expected: PASS with updated helper expectations

**Step 5: Commit**

```bash
git add lib/semantic-enrichment-provider.ts app/api/categorize/route.ts tests/semantic-enrichment-provider.test.ts
git commit -m "whole pipeline turns
shared preprocessing owns all stages
cloud path stays aside"
```

### Task 4: Update Settings and docs copy to cover all three preprocessing stages

**Files:**
- Modify: `app/settings/page.tsx`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`

**Step 1: Write the failing test**

If you extract copy constants, add a small assertion in `tests/semantic-enrichment-provider.test.ts` or `tests/categorization-provider.test.ts`:

```ts
test('preprocessing provider copy mentions image vision, semantic enrichment, and categorization', () => {
  assert.match(PREPROCESSING_PROVIDER_DESCRIPTION, /image vision/i)
  assert.match(PREPROCESSING_PROVIDER_DESCRIPTION, /semantic enrichment/i)
  assert.match(PREPROCESSING_PROVIDER_DESCRIPTION, /categorization/i)
  assert.doesNotMatch(PREPROCESSING_PROVIDER_DESCRIPTION, /AI search uses ollama/i)
})
```

If you keep copy inline, document this as manual-verification-first.

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/categorization-provider.test.ts tests/semantic-enrichment-provider.test.ts`
Expected: FAIL if using extracted copy constants; otherwise skip to minimal UI/doc edits

**Step 3: Write minimal implementation**

Update `app/settings/page.tsx`:

- description under the shared provider should say it controls:
  - image vision
  - semantic enrichment
  - categorization
- keep the note that AI search still uses Anthropic
- update any Ollama success/test copy from “preprocessing” to reflect all three preprocessing stages if needed

Update docs:

- README local preprocessing section
- CLAUDE.md local Ollama section
- AGENTS.md local Ollama section

All docs must state that Ollama now powers all three preprocessing stages when selected, while AI search remains Anthropic-backed.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/categorization-provider.test.ts tests/semantic-enrichment-provider.test.ts`
Expected: PASS if using extracted copy constants; otherwise complete manual verification in Task 5

**Step 5: Commit**

```bash
git add app/settings/page.tsx README.md CLAUDE.md AGENTS.md tests/categorization-provider.test.ts tests/semantic-enrichment-provider.test.ts
git commit -m "copy tells truth
all preprocessing follows one path
search still stands apart"
```

### Task 5: Full verification

**Files:**
- Verify: `tests/categorization-provider.test.ts`
- Verify: `tests/semantic-enrichment-provider.test.ts`
- Verify: `tests/image-vision-provider.test.ts`
- Verify: `lib/categorization-provider.ts`
- Verify: `lib/categorizer.ts`
- Verify: `app/api/categorize/route.ts`
- Verify: `app/settings/page.tsx`

**Step 1: Run focused unit tests**

Run: `node --import tsx --test tests/categorization-provider.test.ts tests/semantic-enrichment-provider.test.ts tests/image-vision-provider.test.ts`
Expected: PASS with all provider tests green

**Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: exit code 0

**Step 3: Run production build**

Run: `npm run build`
Expected: exit code 0, Next.js build succeeds

**Step 4: Manual verification**

Run the app:

```bash
npx next dev
```

Confirm:

- Settings says the shared preprocessing provider controls image vision, semantic enrichment, and categorization
- with provider `ollama`, the full categorization pipeline can complete all three preprocessing stages without Anthropic
- malformed/unavailable Ollama categorization fails the batch with no Claude fallback
- AI search still remains Anthropic-backed

**Step 5: Commit**

```bash
git add lib/categorization-provider.ts lib/categorizer.ts lib/semantic-enrichment-provider.ts app/api/categorize/route.ts app/settings/page.tsx tests/categorization-provider.test.ts tests/semantic-enrichment-provider.test.ts tests/image-vision-provider.test.ts README.md CLAUDE.md AGENTS.md
git commit -m "one switch stays
ollama runs the whole preprocess
search keeps its cloud"
```
