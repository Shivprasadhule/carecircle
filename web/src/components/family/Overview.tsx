import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { LEVEL_LABEL, levelColor, titleCase } from '../../lib/format'
import type { Snapshot } from '../../lib/types'
import { Avatar, Badge, Card, Skeleton } from '../ui/primitives'

const SCORE = { ok: 0.12, info: 0.25, watch: 0.5, high: 0.78, urgent: 0.95 } as const

function RiskGauge({ level }: { level: keyof typeof SCORE }) {
  const r = 52, c = Math.PI * r, pct = SCORE[level]
  return (
    <div className="relative h-[112px] w-[150px]" role="img" aria-label={`Risk: ${LEVEL_LABEL[level]}`}>
      <svg viewBox="0 0 140 84" className="absolute inset-x-0 top-0 h-[84px] w-full">
        <path d="M18,76 A52,52 0 0 1 122,76" fill="none" stroke="var(--line)" strokeWidth="11" strokeLinecap="round" />
        <motion.path d="M18,76 A52,52 0 0 1 122,76" fill="none" stroke={levelColor(level)} strokeWidth="11" strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - pct) }} transition={{ duration: 1.1, ease: 'easeOut' }} />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className="font-display text-lg leading-none" style={{ color: levelColor(level) }}>{LEVEL_LABEL[level]}</div>
      </div>
    </div>
  )
}

export function Overview({ snap }: { snap: Snapshot | null }) {
  if (!snap) return <Skeleton className="h-[170px]" />
  const { person, signals } = snap
  const top = signals.signals.find((s) => s.signal === 'compound_decline') ?? signals.signals[0]
  const level = signals.level
  return (
    <Card className="overflow-hidden p-0" data-testid="overview">
      <div className="flex flex-wrap items-center gap-5 p-5">
        <Avatar name={person.name} size={64} />
        <div className="min-w-[200px] flex-1">
          <h2 className="font-display text-3xl leading-tight">{person.name}</h2>
          <p className="text-sm text-muted">{person.age} · {person.conditions}</p>
          {person.allergies && <p className="text-xs text-muted">Allergies: {person.allergies}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge kind={level}>{LEVEL_LABEL[level]}</Badge>
            <Badge kind="upcoming">{signals.signals.length} signal{signals.signals.length === 1 ? '' : 's'}</Badge>
          </div>
        </div>
        <RiskGauge level={level} />
      </div>
      <motion.div key={level + (top?.signal ?? '')} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="flex items-start gap-3 border-t border-line bg-gradient-to-r from-brand/10 to-transparent px-5 py-3.5">
        <Sparkles size={18} className="mt-0.5 shrink-0 text-brand" />
        <p className="text-sm leading-relaxed" data-testid="insight">
          {top ? <><b>{titleCase(top.signal)}.</b> {top.detail}</> : <><b>Steady week.</b> No concerning patterns in mood, sleep or medicines.</>}
        </p>
      </motion.div>
    </Card>
  )
}
