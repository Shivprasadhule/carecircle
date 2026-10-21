import { motion } from 'framer-motion'
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'
import { avg } from '../../lib/format'
import type { Snapshot } from '../../lib/types'
import { Card, Skeleton } from '../ui/primitives'

export function Sparkline({ values, color, width = 110, height = 34 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2) return <div style={{ width, height }} />
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 6) + 3, height - 4 - ((v - min) / span) * (height - 8)])
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <motion.path d={d} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9 }} />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill={color} />
    </svg>
  )
}

interface Tile { key: string; label: string; value: string; unit?: string; delta: number; goodWhenUp: boolean; series: number[]; hint: string }

export function tilesFrom(s: Snapshot): Tile[] {
  const c = s.checkins_7d
  const mood = c.map((x) => x.mood), sleep = c.flatMap((x) => (x.sleep_hours == null ? [] : [x.sleep_hours])), pain = c.map((x) => x.pain)
  const half = (a: number[]) => (a.length >= 4 ? avg(a.slice(-2)) - avg(a.slice(0, 2)) : 0)
  const adh = Object.values(s.adherence.by_day)
  return [
    { key: 'adherence', label: 'Medicine adherence', value: s.adherence.overall_pct == null ? '–' : `${Math.round(s.adherence.overall_pct)}`, unit: '%', delta: half(adh), goodWhenUp: true, series: adh, hint: `${s.adherence.missed_doses.length} missed this week` },
    { key: 'mood', label: 'Mood', value: mood.length ? String(mood[mood.length - 1]) : '–', unit: '/5', delta: half(mood), goodWhenUp: true, series: mood, hint: 'latest check-in' },
    { key: 'sleep', label: 'Sleep', value: sleep.length ? String(sleep[sleep.length - 1]) : '–', unit: 'h', delta: half(sleep), goodWhenUp: true, series: sleep, hint: 'last night' },
    { key: 'pain', label: 'Pain', value: pain.length ? String(pain[pain.length - 1]) : '–', unit: '/10', delta: half(pain), goodWhenUp: false, series: pain, hint: 'latest check-in' },
  ]
}

export function StatTiles({ snap }: { snap: Snapshot | null }) {
  if (!snap) return <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[118px]" />)}</div>
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4" data-testid="stat-tiles">
      {tilesFrom(snap).map((t, i) => {
        const better = t.delta === 0 ? null : (t.delta > 0) === t.goodWhenUp
        const color = better === null ? 'var(--muted)' : better ? 'var(--ok)' : 'var(--high)'
        const Arrow = t.delta === 0 ? ArrowRight : t.delta > 0 ? ArrowUpRight : ArrowDownRight
        return (
          <motion.div key={t.key} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Card className="p-4" data-testid={`tile-${t.key}`}>
              <div className="flex items-start justify-between">
                <span className="text-xs font-medium text-muted">{t.label}</span>
                <span className="flex items-center text-xs font-semibold" style={{ color }}><Arrow size={14} />{Math.abs(t.delta) < 0.05 ? '' : Math.abs(t.delta).toFixed(1)}</span>
              </div>
              <div className="mt-1 flex items-end justify-between gap-2">
                <div><span className="font-display text-[34px] leading-none">{t.value}</span><span className="ml-0.5 text-sm text-muted">{t.unit}</span></div>
                <Sparkline values={t.series} color={color} />
              </div>
              <div className="mt-1 text-[11px] text-muted">{t.hint}</div>
            </Card>
          </motion.div>
        )
      })}
    </div>
  )
}
