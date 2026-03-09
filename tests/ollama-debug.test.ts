import assert from 'node:assert/strict'
import test from 'node:test'

import { logOllamaResponseDebug } from '../lib/ollama-debug'

test('logOllamaResponseDebug is silent when debug flag is disabled', () => {
  const originalFlag = process.env.SIFTLY_LOG_OLLAMA_RESPONSES
  const originalConsoleInfo = console.info
  const messages: string[] = []

  process.env.SIFTLY_LOG_OLLAMA_RESPONSES = '0'
  console.info = (message?: unknown) => {
    messages.push(String(message ?? ''))
  }

  try {
    logOllamaResponseDebug('semantic-enrichment', '{"ok":true}')
  } finally {
    console.info = originalConsoleInfo
    if (originalFlag === undefined) {
      delete process.env.SIFTLY_LOG_OLLAMA_RESPONSES
    } else {
      process.env.SIFTLY_LOG_OLLAMA_RESPONSES = originalFlag
    }
  }

  assert.equal(messages.length, 0)
})

test('logOllamaResponseDebug logs and truncates when debug flag is enabled', () => {
  const originalFlag = process.env.SIFTLY_LOG_OLLAMA_RESPONSES
  const originalConsoleInfo = console.info
  const messages: string[] = []

  process.env.SIFTLY_LOG_OLLAMA_RESPONSES = '1'
  console.info = (message?: unknown) => {
    messages.push(String(message ?? ''))
  }

  try {
    logOllamaResponseDebug('categorization', 'x'.repeat(4_500))
  } finally {
    console.info = originalConsoleInfo
    if (originalFlag === undefined) {
      delete process.env.SIFTLY_LOG_OLLAMA_RESPONSES
    } else {
      process.env.SIFTLY_LOG_OLLAMA_RESPONSES = originalFlag
    }
  }

  assert.equal(messages.length, 1)
  assert.match(messages[0] ?? '', /\[ollama:categorization\]/)
  assert.match(messages[0] ?? '', /\[truncated \d+ chars\]/)
})
