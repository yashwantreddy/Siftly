const OLLAMA_DEBUG_FLAG = 'SIFTLY_LOG_OLLAMA_RESPONSES'
const MAX_LOG_CHARS = 4_000

function isOllamaDebugEnabled(): boolean {
  const value = process.env[OLLAMA_DEBUG_FLAG]?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

export function logOllamaResponseDebug(
  step: 'image-vision' | 'semantic-enrichment' | 'categorization',
  rawText: string,
): void {
  if (!isOllamaDebugEnabled()) return

  const compact = rawText.trim()
  const truncated = compact.length > MAX_LOG_CHARS
    ? `${compact.slice(0, MAX_LOG_CHARS)}... [truncated ${compact.length - MAX_LOG_CHARS} chars]`
    : compact

  console.info(`[ollama:${step}] ${truncated || '[empty response]'}`)
}
