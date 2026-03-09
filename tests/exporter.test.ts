import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildExportCsvHeaders,
  MAX_CSV_MEDIA_ITEMS,
  serializeBookmarkForCsv,
  serializeBookmarkForJson,
} from '../lib/exporter'

const SAMPLE_BOOKMARK = {
  id: 'bm-1',
  tweetId: '123',
  text: 'Benchmarking AI preprocessing exports',
  authorHandle: 'viperr',
  authorName: 'Viperr',
  source: 'bookmark',
  rawJson: '{"tweet":"raw"}',
  semanticTags: '["react hooks","visual regression"]',
  entities: JSON.stringify({
    hashtags: ['ai', 'bookmarks'],
    urls: ['https://example.com'],
    mentions: ['viperr'],
    tools: ['React', 'Ollama'],
    tweetType: 'thread',
  }),
  enrichedAt: new Date('2026-03-09T12:00:00.000Z'),
  enrichmentMeta: JSON.stringify({
    sentiment: 'positive',
    people: ['Ada Lovelace'],
    companies: ['OpenAI'],
  }),
  tweetCreatedAt: new Date('2026-03-08T12:00:00.000Z'),
  importedAt: new Date('2026-03-09T11:00:00.000Z'),
  mediaItems: [
    {
      id: 'm1',
      type: 'photo',
      url: 'https://cdn.example.com/1.png',
      thumbnailUrl: null,
      localPath: '/tmp/1.png',
      imageTags: JSON.stringify({
        people: ['developer at desk'],
        text_ocr: ['Hello world'],
        objects: ['laptop'],
        scene: 'office desk',
        action: 'coding',
        mood: 'educational',
        style: 'screenshot',
        meme_template: null,
        tags: ['react hooks', 'terminal'],
      }),
    },
    {
      id: 'm2',
      type: 'photo',
      url: 'https://cdn.example.com/2.png',
      thumbnailUrl: 'https://cdn.example.com/2-thumb.png',
      localPath: null,
      imageTags: JSON.stringify({
        people: [],
        text_ocr: [],
        objects: ['chart'],
        scene: 'dashboard',
        action: 'showing metrics',
        mood: 'neutral',
        style: 'chart',
        meme_template: null,
        tags: ['analytics'],
      }),
    },
    {
      id: 'm3',
      type: 'gif',
      url: 'https://cdn.example.com/3.gif',
      thumbnailUrl: null,
      localPath: null,
      imageTags: JSON.stringify({
        people: [],
        text_ocr: ['ship it'],
        objects: ['rocket'],
        scene: 'meme',
        action: 'celebrating',
        mood: 'humorous',
        style: 'gif',
        meme_template: 'Success Kid',
        tags: ['shipping'],
      }),
    },
    {
      id: 'm4',
      type: 'photo',
      url: 'https://cdn.example.com/4.png',
      thumbnailUrl: null,
      localPath: null,
      imageTags: JSON.stringify({
        people: ['speaker'],
        text_ocr: ['Build fast'],
        objects: ['stage'],
        scene: 'conference',
        action: 'presenting',
        mood: 'inspiring',
        style: 'photo',
        meme_template: null,
        tags: ['keynote'],
      }),
    },
    {
      id: 'm5',
      type: 'video',
      url: 'https://cdn.example.com/5.mp4',
      thumbnailUrl: 'https://cdn.example.com/5-thumb.png',
      localPath: '/tmp/5.mp4',
      imageTags: JSON.stringify({
        people: ['founder'],
        text_ocr: ['v5 launch'],
        objects: ['phone'],
        scene: 'demo',
        action: 'launching product',
        mood: 'celebratory',
        style: 'video',
        meme_template: null,
        tags: ['launch'],
      }),
    },
  ],
  categories: [
    {
      confidence: 0.92,
      category: { name: 'AI Resources', slug: 'ai-resources', color: '#fff' },
    },
    {
      confidence: 0.71,
      category: { name: 'Dev Tools', slug: 'dev-tools', color: '#000' },
    },
  ],
}

test('serializeBookmarkForJson includes parsed preprocessing fields', () => {
  const exported = serializeBookmarkForJson(SAMPLE_BOOKMARK)

  assert.deepEqual(exported.semanticTags, ['react hooks', 'visual regression'])
  assert.deepEqual(exported.entities, {
    hashtags: ['ai', 'bookmarks'],
    urls: ['https://example.com'],
    mentions: ['viperr'],
    tools: ['React', 'Ollama'],
    tweetType: 'thread',
  })
  assert.deepEqual(exported.enrichmentMeta, {
    sentiment: 'positive',
    people: ['Ada Lovelace'],
    companies: ['OpenAI'],
  })
  assert.equal(exported.categories[0]?.confidence, 0.92)
  assert.equal(exported.mediaItems[0]?.imageTags?.scene, 'office desk')
  assert.equal(exported.mediaItems[0]?.localPath, '/tmp/1.png')
})

test('buildExportCsvHeaders includes flattened preprocessing columns', () => {
  const headers = buildExportCsvHeaders()

  assert.ok(headers.includes('semantic_tags'))
  assert.ok(headers.includes('sentiment'))
  assert.ok(headers.includes('entity_tools'))
  assert.ok(headers.includes('category_confidences'))
  assert.ok(headers.includes('media1_scene'))
  assert.ok(headers.includes(`media${MAX_CSV_MEDIA_ITEMS}_tags`))
  assert.ok(headers.includes('media_overflow_json'))
})

test('serializeBookmarkForCsv flattens preprocessing fields and preserves overflow', () => {
  const row = serializeBookmarkForCsv(SAMPLE_BOOKMARK)

  assert.equal(row.semantic_tags, 'react hooks; visual regression')
  assert.equal(row.sentiment, 'positive')
  assert.equal(row.people, 'Ada Lovelace')
  assert.equal(row.companies, 'OpenAI')
  assert.equal(row.entity_hashtags, 'ai; bookmarks')
  assert.equal(row.entity_tools, 'React; Ollama')
  assert.equal(row.category_slugs, 'ai-resources; dev-tools')
  assert.equal(row.category_confidences, '0.92; 0.71')
  assert.equal(row.media1_scene, 'office desk')
  assert.equal(row.media1_text_ocr, 'Hello world')
  assert.equal(row.media4_mood, 'inspiring')
  assert.match(row.media_overflow_json, /5\.mp4/)
  assert.match(row.media_overflow_json, /launching product/)
})
