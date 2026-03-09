# Ollama Categorization Design

## Goal

Extend the existing shared preprocessing provider so categorization follows the same `imageVisionProvider` setting as image vision and semantic enrichment. When the provider is `ollama`, all three preprocessing stages run on Ollama using the same shared Ollama model. When the provider is `anthropic`, all three use the existing Claude paths.

## Decisions

- Reuse the existing shared preprocessing switch:
  - `imageVisionProvider`: `anthropic` or `ollama`
  - `ollamaBaseUrl`
  - `ollamaVisionModel`
- Do not add a separate categorization model or provider setting.
- Keep the no-fallback rule:
  - if provider is `ollama`, categorization must not fall back to Claude CLI or Anthropic SDK
  - Ollama unavailability, malformed JSON, or invalid assignment payloads fail the categorization batch outright
- Keep the output/storage contract unchanged:
  - same `CategorizationResult[]` shape
  - same category slug filtering
  - same confidence clamping behavior
  - same `BookmarkCategory` persistence and `enrichedAt` updates
- Update product copy to say the shared preprocessing provider controls:
  - image vision
  - semantic enrichment
  - categorization
- Leave AI search unchanged and Anthropic-backed.

## Runtime Design

Introduce a dedicated categorization provider module that owns:

- prompt construction for categorization
- response normalization and validation
- Anthropic categorization adapter
- Ollama categorization adapter

`lib/categorizer.ts` remains the orchestration layer, but `categorizeBatch()` becomes provider-aware:

- `anthropic`
  - keep current Claude CLI-first behavior
  - fall back to Anthropic SDK if CLI output is unavailable or unparseable
- `ollama`
  - call the native Ollama HTTP API directly
  - use the shared Ollama model and base URL
  - parse only valid JSON arrays with `tweetId` plus `assignments`
  - reject malformed or partial payloads

The pipeline route already resolves the shared preprocessing provider. After this change:

- it must stop treating categorization as Anthropic-only
- if provider is `ollama`, the pipeline can run all three preprocessing stages without Anthropic
- if provider is `anthropic`, behavior stays the same

## Error Handling

- Ollama categorization errors are provider errors, not soft fallbacks.
- Failed categorization batches must not partially persist assignments.
- Existing logging remains, but messages should clearly say whether the failure came from `ollama` or `anthropic`.
- Route/UI copy should no longer warn that categorization is skipped when Anthropic is absent if preprocessing provider is `ollama`.

## Verification

- Add focused provider tests for categorization parsing and Ollama error handling.
- Verify the shared-provider requirement helper now reports no Anthropic requirement for categorization when provider is `ollama`.
- Run:
  - `node --import tsx --test ...`
  - `npx tsc --noEmit`
  - `npm run build`
- Manual check:
  - settings copy mentions all three preprocessing stages
  - pipeline can complete vision, enrichment, and categorization on Ollama alone
  - AI search still depends on Anthropic
