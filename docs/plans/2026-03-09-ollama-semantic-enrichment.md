# Ollama Semantic Enrichment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make semantic enrichment use Ollama whenever the shared preprocessing provider is set to `ollama`, while preserving the existing stored `semanticTags` and `enrichmentMeta` shapes.

**Architecture:** Reuse the existing shared preprocessing provider setting introduced for image vision. Add a provider-normalization module for semantic enrichment, route `anthropic` through the current CLI-first / SDK-fallback path, route `ollama` through the native Ollama HTTP API with no Claude fallback, and keep persistence logic unchanged in the pipeline.

**Tech Stack:** Next.js App Router, TypeScript, node:test via `tsx`, Anthropic SDK, native `fetch`, Prisma/SQLite

---

### Task 1: Lock the enrichment output contract with failing tests

**Files:**
- Create: `tests/semantic-enrichment-provider.test.ts`
- Test: `tests/semantic-enrichment-provider.test.ts`

**Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  extractCanonicalEnrichmentJson,
  parseEnrichmentResponse,
  getSemanticEnrichmentTestPrompt,
} from '../lib/semantic-enrichment-provider'

test('parseEnrichmentResponse returns canonical enrichment rows', () => {
  const rows = parseEnrichmentResponse(
    '[{"id":"abc","tags":["react hooks","frontend"],"sentiment":"positive","people":["Dan Abramov"],"companies":["React"]}]',
  )

  assert.deepEqual(rows, [{
    id: 'abc',
    tags: ['react hooks', 'frontend'],
    sentiment: 'positive',
    people: ['Dan Abramov'],
    companies: ['React'],
  }])
})

test('extractCanonicalEnrichmentJson rejects missing required fields', () => {
  assert.throws(
    () => extractCanonicalEnrichmentJson('[{"id":"abc","tags":["x"]}]'),
    /missing required enrichment fields/i,
  )
})

test('getSemanticEnrichmentTestPrompt keeps the existing JSON contract', () => {
  const prompt = getSemanticEnrichmentTestPrompt()
  assert.match(prompt, /"sentiment"/)
  assert.match(prompt, /"companies"/)
})
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/semantic-enrichment-provider.test.ts`
Expected: FAIL with `Cannot find module '../lib/semantic-enrichment-provider'`

**Step 3: Write minimal implementation**

Create `lib/semantic-enrichment-provider.ts` with:

```ts
export interface EnrichmentResult {
  id: string
  tags: string[]
  sentiment: string
  people: string[]
  companies: string[]
}

const REQUIRED_ENRICHMENT_FIELDS = ['id', 'tags', 'sentiment', 'people', 'companies'] as const

export function getSemanticEnrichmentPrompt(bookmarksJson: string): string {
  return `Generate search tags and metadata for each of these Twitter/X bookmarks.

For each bookmark return:
- tags: 25-35 specific semantic search tags covering entities, actions, visual content, synonyms, and emotional signals
- sentiment: one of "positive", "negative", "neutral", "humorous", "controversial"
- people: named people mentioned or shown (max 5, empty array if none)
- companies: company/product/tool names explicitly referenced (max 8, empty array if none)

Return ONLY valid JSON, no markdown:
[{"id":"...","tags":[...],"sentiment":"...","people":[...],"companies":[...]}]

BOOKMARKS:
${bookmarksJson}`
}

export function getSemanticEnrichmentTestPrompt(): string {
  return getSemanticEnrichmentPrompt('[{"id":"demo"}]')
}

export function parseEnrichmentResponse(text: string): EnrichmentResult[] {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []
  const parsed = JSON.parse(match[0]) as Record<string, unknown>[]
  return parsed.map((item) => ({
    id: String(item.id ?? ''),
    tags: Array.isArray(item.tags) ? item.tags.map(String).filter(Boolean) : [],
    sentiment: String(item.sentiment ?? 'neutral'),
    people: Array.isArray(item.people) ? item.people.map(String).filter(Boolean) : [],
    companies: Array.isArray(item.companies) ? item.companies.map(String).filter(Boolean) : [],
  })).filter((row) => row.id)
}

export function extractCanonicalEnrichmentJson(text: string): string {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('Enrichment response did not contain a JSON array.')
  const parsed = JSON.parse(match[0]) as Record<string, unknown>[]
  for (const row of parsed) {
    const missing = REQUIRED_ENRICHMENT_FIELDS.filter((field) => !(field in row))
    if (missing.length) {
      throw new Error(`Response missing required enrichment fields: ${missing.join(', ')}`)
    }
  }
  return JSON.stringify(parsed)
}
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/semantic-enrichment-provider.test.ts`
Expected: PASS with 3 passing tests

**Step 5: Commit**

```bash
git add tests/semantic-enrichment-provider.test.ts lib/semantic-enrichment-provider.ts
git commit -m "plan tags bloom
shared contract guards the local path
json keeps its shape"
```

### Task 2: Add Anthropic and Ollama enrichment adapters behind the shared preprocessing provider

**Files:**
- Modify: `lib/semantic-enrichment-provider.ts`
- Modify: `lib/vision-analyzer.ts`
- Test: `tests/semantic-enrichment-provider.test.ts`

**Step 1: Write the failing test**

Add tests for:

```ts
test('createOllamaSemanticEnrichmentProvider parses message.content JSON arrays', async () => {
  const provider = createOllamaSemanticEnrichmentProvider({
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3.5:9b',
    fetchImpl: async () => new Response(JSON.stringify({
      message: {
        content: '[{"id":"abc","tags":["rag"],"sentiment":"neutral","people":[],"companies":["Ollama"]}]',
      },
    }), { status: 200 }),
  })

  const rows = await provider.enrich('[{"id":"abc","text":"hello"}]')
  assert.equal(rows[0]?.id, 'abc')
  assert.deepEqual(rows[0]?.companies, ['Ollama'])
})

test('createOllamaSemanticEnrichmentProvider throws on HTTP config errors', async () => {
  const provider = createOllamaSemanticEnrichmentProvider({
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3.5:9b',
    fetchImpl: async () => new Response(JSON.stringify({ error: 'model not found' }), { status: 404 }),
  })

  await assert.rejects(() => provider.enrich('[{"id":"abc"}]'), /model not found/i)
})
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/semantic-enrichment-provider.test.ts`
Expected: FAIL because enrichment provider factories do not exist yet

**Step 3: Write minimal implementation**

Extend `lib/semantic-enrichment-provider.ts` with:

```ts
import Anthropic from '@anthropic-ai/sdk'
import { ImageVisionProviderError } from '@/lib/image-vision-provider'

export interface SemanticEnrichmentProvider {
  enrich(bookmarksJson: string): Promise<EnrichmentResult[]>
}

export function createAnthropicSemanticEnrichmentProvider(options: {
  client: Anthropic
  model: string
}): SemanticEnrichmentProvider {
  return {
    async enrich(bookmarksJson) {
      const prompt = getSemanticEnrichmentPrompt(bookmarksJson)
      const msg = await options.client.messages.create({
        model: options.model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      })
      const text = msg.content.find((b) => b.type === 'text')?.text ?? ''
      return parseEnrichmentResponse(text)
    },
  }
}

export function createOllamaSemanticEnrichmentProvider(options: {
  baseUrl: string
  model: string
  fetchImpl?: typeof fetch
}): SemanticEnrichmentProvider {
  const fetchImpl = options.fetchImpl ?? fetch

  return {
    async enrich(bookmarksJson) {
      const response = await fetchImpl(`${options.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          stream: false,
          messages: [{ role: 'user', content: getSemanticEnrichmentPrompt(bookmarksJson) }],
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const error = payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).error === 'string'
          ? (payload as Record<string, unknown>).error as string
          : `HTTP ${response.status}`
        throw new ImageVisionProviderError(`Ollama semantic enrichment error: ${error}`, {
          code: response.status >= 500 ? 'network' : 'config',
          provider: 'ollama',
          retryable: false,
        })
      }
      const text = payload && typeof payload === 'object'
        ? typeof (payload as Record<string, unknown>).response === 'string'
          ? (payload as Record<string, unknown>).response as string
          : ((payload as Record<string, unknown>).message as { content?: string } | undefined)?.content ?? ''
        : ''
      return parseEnrichmentResponse(extractCanonicalEnrichmentJson(text))
    },
  }
}
```

Then modify `lib/vision-analyzer.ts`:
- move the prompt builder and parser helpers to `lib/semantic-enrichment-provider.ts`
- resolve `getImageVisionProvider()` before enrichment
- when provider is `anthropic`, keep current CLI-first / SDK-fallback behavior
- when provider is `ollama`, skip Claude CLI entirely, call `createOllamaSemanticEnrichmentProvider(...)`, and throw provider errors upward without fallback

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/semantic-enrichment-provider.test.ts`
Expected: PASS with provider factory coverage added

**Step 5: Commit**

```bash
git add lib/semantic-enrichment-provider.ts lib/vision-analyzer.ts tests/semantic-enrichment-provider.test.ts
git commit -m "local tags align
shared provider drives enrichment now
no fallback leaks out"
```

### Task 3: Wire the shared preprocessing provider through the pipeline route

**Files:**
- Modify: `app/api/categorize/route.ts:146-340`
- Modify: `lib/vision-analyzer.ts:332-545`
- Test: `tests/semantic-enrichment-provider.test.ts`

**Step 1: Write the failing test**

Add a pure helper test for route-level client requirements:

```ts
test('semantic enrichment does not require an Anthropic client when preprocessing provider is ollama', async () => {
  const provider = resolvePreprocessingProvider('ollama')
  assert.equal(provider.requiresAnthropicClientForEnrichment, false)
})
```

If you keep the helper in `lib/semantic-enrichment-provider.ts`, test that there instead of importing the route.

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/semantic-enrichment-provider.test.ts`
Expected: FAIL because the helper does not exist yet

**Step 3: Write minimal implementation**

In `app/api/categorize/route.ts`:
- resolve the shared preprocessing provider once near the top of the pipeline job
- only require Anthropic for image vision / enrichment when the provider is `anthropic`
- still resolve Anthropic for categorization exactly as today
- update the missing-auth error path so it is accurate:
  - if preprocessing provider is `ollama`, do not abort the pipeline just because Anthropic is absent
  - only abort categorization when Anthropic is unavailable for that stage
- leave the persistence semantics unchanged:
  - successful enrichment writes `semanticTags` and `enrichmentMeta`
  - failed enrichment leaves `semanticTags` as `null`

Add a small pure helper if needed:

```ts
export function getPipelineAiRequirements(provider: 'anthropic' | 'ollama') {
  return {
    needsAnthropicForVision: provider === 'anthropic',
    needsAnthropicForEnrichment: provider === 'anthropic',
    needsAnthropicForCategorization: true,
  }
}
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/semantic-enrichment-provider.test.ts`
Expected: PASS with the new helper assertions

**Step 5: Commit**

```bash
git add app/api/categorize/route.ts lib/vision-analyzer.ts lib/semantic-enrichment-provider.ts tests/semantic-enrichment-provider.test.ts
git commit -m "pipeline paths split
ollama handles local preprocessing
claude keeps ranking"
```

### Task 4: Update Settings UI copy to reflect shared preprocessing scope

**Files:**
- Modify: `app/settings/page.tsx:360-560`
- Modify: `README.md:120-260`
- Modify: `CLAUDE.md:26-50`
- Modify: `AGENTS.md:26-50`

**Step 1: Write the failing test**

No automated UI test harness exists in this repo. Instead, write a small assertion test over exported copy constants if you extract them, or skip to the smallest pure unit you can verify. If you keep the copy inline, document this task as manual-verification-first.

Recommended minimal test if you extract the description:

```ts
test('preprocessing provider description mentions both image vision and semantic enrichment', () => {
  assert.match(PREPROCESSING_PROVIDER_DESCRIPTION, /image vision/i)
  assert.match(PREPROCESSING_PROVIDER_DESCRIPTION, /semantic enrichment/i)
  assert.doesNotMatch(PREPROCESSING_PROVIDER_DESCRIPTION, /categorization and AI search still use ollama/i)
})
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/semantic-enrichment-provider.test.ts`
Expected: FAIL because the extracted copy constant or wording does not exist yet

**Step 3: Write minimal implementation**

Update `app/settings/page.tsx`:
- rename the label from `Image vision provider` to `AI preprocessing provider`
- change the description to say it controls `image vision` and `semantic enrichment`
- keep the note that `categorization` and `AI search` still use Anthropic
- rename `Ollama vision model` copy to `Ollama preprocessing model`
- keep the same setting keys; do not rename DB keys in this slice

Update docs so they match the implemented behavior:
- README: Ollama now powers image vision and semantic enrichment when selected
- CLAUDE.md and AGENTS.md: same scope clarification

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/semantic-enrichment-provider.test.ts`
Expected: PASS if you extracted copy constants; otherwise perform manual verification in Task 5 and note the absence of a UI test harness

**Step 5: Commit**

```bash
git add app/settings/page.tsx README.md CLAUDE.md AGENTS.md tests/semantic-enrichment-provider.test.ts
git commit -m "copy says more
shared preprocessing scope is clear
ui matches the flow"
```

### Task 5: Full verification

**Files:**
- Verify: `tests/semantic-enrichment-provider.test.ts`
- Verify: `tests/image-vision-provider.test.ts`
- Verify: `lib/semantic-enrichment-provider.ts`
- Verify: `lib/vision-analyzer.ts`
- Verify: `app/api/categorize/route.ts`
- Verify: `app/settings/page.tsx`

**Step 1: Run focused unit tests**

Run: `node --import tsx --test tests/semantic-enrichment-provider.test.ts tests/image-vision-provider.test.ts`
Expected: PASS with all enrichment and image-vision provider tests green

**Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: exit code 0, no TypeScript errors

**Step 3: Run production build**

Run: `npm run build`
Expected: exit code 0, Next.js build succeeds

**Step 4: Manual verification**

Run the app and verify:

```bash
npx next dev
```

Then confirm:
- Settings shows `AI preprocessing provider`
- With provider `ollama`, the copy says image vision + semantic enrichment use Ollama
- The Ollama model field still defaults to `qwen3.5:9b`
- Running the categorization pipeline with provider `ollama` enriches bookmarks without requiring Claude for the enrichment stage
- Categorization itself still requires Anthropic/Claude

**Step 5: Commit**

```bash
git add app/api/categorize/route.ts app/settings/page.tsx lib/semantic-enrichment-provider.ts lib/vision-analyzer.ts tests/semantic-enrichment-provider.test.ts README.md CLAUDE.md AGENTS.md
git commit -m "shared path holds
ollama enriches local metadata
types and build stay green"
```
