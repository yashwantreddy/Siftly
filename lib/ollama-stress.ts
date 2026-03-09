export interface StressSweepOptions {
  concurrency: number
  count: number
  timeoutMs: number
  runTask: (index: number, signal: AbortSignal) => Promise<void>
}

export interface StressSweepSummary {
  concurrency: number
  requested: number
  succeeded: number
  failed: number
  wallTimeMs: number
  maxInFlight: number
  effectiveParallelism: number
  durationsMs: number[]
  errors: string[]
}

function now(): number {
  return performance.now()
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function runTaskWithTimeout(
  index: number,
  timeoutMs: number,
  runTask: StressSweepOptions['runTask'],
): Promise<{ durationMs: number; error: string | null }> {
  const startedAt = now()
  const controller = new AbortController()

  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    await Promise.race([
      runTask(index, controller.signal),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort(new Error(`Task ${index} timed out after ${timeoutMs}ms`))
          reject(new Error(`Task ${index} timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])

    return { durationMs: now() - startedAt, error: null }
  } catch (error) {
    return { durationMs: now() - startedAt, error: toErrorMessage(error) }
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export async function runStressSweep(options: StressSweepOptions): Promise<StressSweepSummary> {
  const concurrency = Math.max(1, Math.floor(options.concurrency))
  const requested = Math.max(0, Math.floor(options.count))
  const durationsMs = Array<number>(requested).fill(0)
  const errors: string[] = []

  let nextIndex = 0
  let currentInFlight = 0
  let maxInFlight = 0
  let succeeded = 0
  let failed = 0

  const wallStartedAt = now()

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++
      if (index >= requested) return

      currentInFlight++
      maxInFlight = Math.max(maxInFlight, currentInFlight)

      try {
        const result = await runTaskWithTimeout(index, options.timeoutMs, options.runTask)
        durationsMs[index] = result.durationMs
        if (result.error) {
          failed++
          errors.push(result.error)
        } else {
          succeeded++
        }
      } finally {
        currentInFlight--
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, requested) }, () => worker()))

  const wallTimeMs = now() - wallStartedAt
  const totalTaskTimeMs = durationsMs.reduce((sum, duration) => sum + duration, 0)
  const effectiveParallelism = wallTimeMs > 0 ? totalTaskTimeMs / wallTimeMs : 0

  return {
    concurrency,
    requested,
    succeeded,
    failed,
    wallTimeMs,
    maxInFlight,
    effectiveParallelism,
    durationsMs,
    errors,
  }
}
