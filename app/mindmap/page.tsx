'use client'

import { useEffect, useState } from 'react'
import { Bookmark, CheckCircle, Gauge, Layers3, Loader2, Play, Sparkles } from 'lucide-react'
import type { Node, Edge } from '@xyflow/react'
import dynamic from 'next/dynamic'
import type { MindmapCategorizationSummary } from '@/lib/mindmap-categorization-progress'

const MindmapCanvas = dynamic(
  () => import('@/components/mindmap/mindmap-canvas'),
  { ssr: false, loading: () => <CanvasLoader /> },
)

interface MindmapData {
  nodes: Node[]
  edges: Edge[]
}

interface CategoryLegendItem {
  name: string
  color: string
  slug: string
}

type CategorizeStage = 'vision' | 'entities' | 'enrichment' | 'categorize' | 'parallel' | null

interface CategorizeStatus {
  status: 'idle' | 'running' | 'stopping'
  stage: CategorizeStage
  done: number
  total: number
}

const STAGE_LABELS: Record<NonNullable<CategorizeStage>, string> = {
  entities: 'Extracting entities...',
  vision: 'Analyzing images...',
  enrichment: 'Generating semantic tags...',
  categorize: 'Categorizing bookmarks...',
  parallel: 'Processing bookmarks in parallel...',
}

function CanvasLoader() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Loader2 size={32} className="animate-spin text-indigo-400" />
    </div>
  )
}

function Legend({ categories }: { categories: CategoryLegendItem[] }) {
  if (categories.length === 0) return null

  return (
    <div className="absolute left-4 top-4 z-10 max-w-52 rounded-xl border border-zinc-800 bg-zinc-900/90 p-4 backdrop-blur-sm">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Categories</p>
      <div className="space-y-2">
        {categories.map((category) => (
          <div key={category.slug} className="flex items-center gap-2">
            <Bookmark size={12} className="shrink-0" style={{ color: category.color, fill: category.color }} />
            <span className="truncate text-xs text-zinc-300">{category.name}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-zinc-600">Click a category to expand</p>
    </div>
  )
}

function extractLegend(nodes: Node[]): CategoryLegendItem[] {
  return nodes
    .filter((node) => node.type === 'category')
    .map((node) => {
      const data = node.data as { name: string; color: string; slug: string }
      return { name: data.name, color: data.color, slug: data.slug }
    })
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-zinc-800">
      <div
        className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-sky-400 to-emerald-400 transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
}

function ProgressSummary({
  summary,
  pipeline,
}: {
  summary: MindmapCategorizationSummary
  pipeline: CategorizeStatus | null
}) {
  const scopedRunProgress = pipeline?.total && pipeline.total > 0
    ? Math.round((pipeline.done / pipeline.total) * 100)
    : 0
  const stageLabel = pipeline?.stage ? STAGE_LABELS[pipeline.stage] : null

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
          <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Categorized</p>
          <p className="mt-1 text-lg font-semibold text-zinc-100">{summary.categorizedCount}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
          <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Left</p>
          <p className="mt-1 text-lg font-semibold text-zinc-100">{summary.remainingCount}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
          <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Complete</p>
          <p className="mt-1 text-lg font-semibold text-zinc-100">{summary.progressPercent}%</p>
        </div>
      </div>

      <div className="space-y-2">
        <ProgressBar value={summary.progressPercent} />
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>{summary.categorizedCount} of {summary.totalBookmarks} categorized</span>
          <span>{summary.remainingCount} left</span>
        </div>
      </div>

      {pipeline && pipeline.status !== 'idle' && (
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/8 p-3">
          <div className="flex items-center gap-2 text-indigo-300">
            <Loader2 size={14} className="animate-spin" />
            <p className="text-sm font-medium">{stageLabel ?? 'Starting...'}</p>
          </div>
          <div className="mt-2 space-y-2">
            <ProgressBar value={scopedRunProgress} />
            <p className="text-xs text-indigo-200/80">
              Current run: {pipeline.done} / {pipeline.total} bookmarks
              {pipeline.total > 0 && ` (${scopedRunProgress}%)`}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function CategorizationCard({
  summary,
  pipeline,
  busy,
  done,
  error,
  onCategorizeFirst,
  onCategorizeRest,
}: {
  summary: MindmapCategorizationSummary
  pipeline: CategorizeStatus | null
  busy: boolean
  done: boolean
  error: string
  onCategorizeFirst: () => void
  onCategorizeRest: () => void
}) {
  const canCategorizeFirst = summary.firstBookmarkId !== null && !summary.firstBookmarkCategorized && !busy
  const canCategorizeRest = summary.restBookmarkIds.length > 0 && !busy

  return (
    <div className="rounded-[1.6rem] border border-zinc-700/60 bg-zinc-900/94 p-6 text-left shadow-2xl backdrop-blur-xl">
      {done ? (
        <div className="flex flex-col items-center gap-4 py-3 text-center">
          <CheckCircle size={42} className="text-emerald-400" />
          <div>
            <p className="text-xl font-semibold text-zinc-100">Categorization complete</p>
            <p className="mt-1 text-sm text-zinc-500">Reloading the mindmap with the latest assignments.</p>
          </div>
          <Loader2 size={18} className="animate-spin text-indigo-400" />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-indigo-300">
                <Layers3 size={15} />
                <span className="text-[11px] uppercase tracking-[0.28em]">Mindmap Prep</span>
              </div>
              <div>
                <p className="text-xl font-semibold text-zinc-100">
                  {summary.categorizedCount === 0 ? 'Prove categorization works first' : 'Continue categorizing'}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                  Run the first bookmark through the real AI pipeline, then categorize the rest when you want to fill out the graph.
                </p>
              </div>
            </div>

            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-indigo-500/20 bg-indigo-500/10">
              {busy ? (
                <Loader2 size={22} className="animate-spin text-indigo-300" />
              ) : (
                <Gauge size={22} className="text-indigo-300" />
              )}
            </div>
          </div>

          <ProgressSummary summary={summary} pipeline={pipeline} />

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="grid gap-2">
            <button
              type="button"
              onClick={onCategorizeFirst}
              disabled={!canCategorizeFirst}
              className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              <Play size={15} />
              {summary.firstBookmarkCategorized ? 'First bookmark already categorized' : 'Categorize first bookmark'}
            </button>
            <button
              type="button"
              onClick={onCategorizeRest}
              disabled={!canCategorizeRest}
              className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950/80 px-4 py-3 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-600"
            >
              <Sparkles size={15} />
              Categorize rest of the bookmarks
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

async function fetchMindmapData(): Promise<MindmapData> {
  const response = await fetch('/api/mindmap')
  if (!response.ok) {
    throw new Error('Failed to load mindmap')
  }

  return response.json() as Promise<MindmapData>
}

async function fetchMindmapSummary(): Promise<MindmapCategorizationSummary> {
  const response = await fetch('/api/mindmap/summary')
  if (!response.ok) {
    throw new Error('Failed to load mindmap summary')
  }

  return response.json() as Promise<MindmapCategorizationSummary>
}

async function fetchCategorizeStatus(): Promise<CategorizeStatus> {
  const response = await fetch('/api/categorize')
  if (!response.ok) {
    throw new Error('Failed to load categorization status')
  }

  return response.json() as Promise<CategorizeStatus>
}

export default function MindmapPage() {
  const [data, setData] = useState<MindmapData | null>(null)
  const [summary, setSummary] = useState<MindmapCategorizationSummary | null>(null)
  const [pipeline, setPipeline] = useState<CategorizeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    Promise.all([
      fetchMindmapData(),
      fetchMindmapSummary(),
      fetchCategorizeStatus(),
    ])
      .then(([mindmapData, summaryData, pipelineStatus]) => {
        setData(mindmapData)
        setSummary(summaryData)
        setPipeline(pipelineStatus)
        setBusy(pipelineStatus.status === 'running' || pipelineStatus.status === 'stopping')
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Unknown error'))
      .finally(() => setLoading(false))
  }, [])

  const pipelineState = pipeline?.status

  useEffect(() => {
    if (pipelineState !== 'running' && pipelineState !== 'stopping') {
      return
    }

    const interval = window.setInterval(async () => {
      try {
        const [pipelineStatus, summaryData] = await Promise.all([
          fetchCategorizeStatus(),
          fetchMindmapSummary(),
        ])

        setPipeline(pipelineStatus)
        setSummary(summaryData)

        if (pipelineStatus.status === 'idle') {
          window.clearInterval(interval)
          setBusy(false)
          setDone(true)
          window.setTimeout(() => window.location.reload(), 800)
        }
      } catch {
        window.clearInterval(interval)
        setBusy(false)
      }
    }, 1500)

    return () => window.clearInterval(interval)
  }, [pipelineState])

  async function startCategorization(bookmarkIds: string[]) {
    if (bookmarkIds.length === 0) {
      return
    }

    setActionError('')
    setDone(false)
    setBusy(true)

    try {
      const response = await fetch('/api/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookmarkIds }),
      })
      const payload = await response.json() as { error?: string }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to start categorization')
      }

      const [pipelineStatus, summaryData] = await Promise.all([
        fetchCategorizeStatus(),
        fetchMindmapSummary(),
      ])

      setPipeline(pipelineStatus)
      setSummary(summaryData)
    } catch (err) {
      setBusy(false)
      setActionError(err instanceof Error ? err.message : 'Failed to start categorization')
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={36} className="animate-spin text-indigo-400" />
          <p className="text-sm text-zinc-400">Loading mindmap...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <p className="text-zinc-400">{error}</p>
      </div>
    )
  }

  if (!data || !summary) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <p className="text-zinc-400">Failed to load mindmap data.</p>
      </div>
    )
  }

  if (summary.totalBookmarks === 0) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <div className="text-center">
          <p className="text-xl font-semibold text-zinc-400">No data to display</p>
          <p className="mt-1 text-sm text-zinc-600">Import bookmarks first, then return to the mindmap.</p>
        </div>
      </div>
    )
  }

  const totalCategorizedNodes = data.nodes
    .filter((node) => node.type === 'category')
    .reduce((sum, node) => sum + (((node.data as { count?: number }).count) ?? 0), 0)
  const hasCategorizedBookmarks = summary.categorizedCount > 0 || totalCategorizedNodes > 0
  const showEmptyState = !hasCategorizedBookmarks
  const legend = extractLegend(data.nodes)

  return (
    <div className="relative h-screen w-full">
      <Legend categories={legend} />
      <MindmapCanvas initialNodes={data.nodes} initialEdges={data.edges} />

      {showEmptyState ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-950/78 px-4 backdrop-blur-sm">
          <div className="w-full max-w-xl">
            <CategorizationCard
              summary={summary}
              pipeline={pipeline}
              busy={busy}
              done={done}
              error={actionError}
              onCategorizeFirst={() => void startCategorization(summary.firstBookmarkId ? [summary.firstBookmarkId] : [])}
              onCategorizeRest={() => void startCategorization(summary.restBookmarkIds)}
            />
          </div>
        </div>
      ) : (
        <div className="absolute right-4 top-4 z-10 w-[24rem] max-w-[calc(100vw-2rem)]">
          <CategorizationCard
            summary={summary}
            pipeline={pipeline}
            busy={busy}
            done={done}
            error={actionError}
            onCategorizeFirst={() => void startCategorization(summary.firstBookmarkId ? [summary.firstBookmarkId] : [])}
            onCategorizeRest={() => void startCategorization(summary.restBookmarkIds)}
          />
        </div>
      )}
    </div>
  )
}
