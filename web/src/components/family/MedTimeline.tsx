import { AnimatePresence, motion } from 'framer-motion'
import { Check, Pill, Utensils } from 'lucide-react'
import { fmtSlot } from '../../lib/format'
import { useCare } from '../../state/care'
import { Badge, Card, SectionTitle } from '../ui/primitives'

export function MedTimeline() {
  const { snap, markTaken, can } = useCare()
  const canLog = can('dose:log')
  const doses = snap?.doses_today ?? []
  const taken = doses.filter((d) => d.status === 'taken').length
  return (
    <Card data-testid="med-timeline">
      <SectionTitle right={<span className="text-xs text-muted">{taken}/{doses.length} taken</span>}>Today's medicines</SectionTitle>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-bg2"><motion.div className="h-full rounded-full bg-ok" animate={{ width: `${doses.length ? (taken / doses.length) * 100 : 0}%` }} /></div>
      <ol className="relative space-y-1">
        <AnimatePresence initial={false}>
          {doses.map((d) => {
            const done = d.status === 'taken'
            const open = canLog && !['taken', 'missed', 'skipped'].includes(d.status)
            return (
              <motion.li layout key={d.med_id + d.slot} className="flex items-center gap-3 rounded-2xl px-2 py-2.5 transition hover:bg-surface2" data-testid={`dose-${d.medication}-${d.slot}`}>
                <button disabled={!open} onClick={() => markTaken(d)} aria-label={done ? `${d.medication} taken` : open ? `Mark ${d.medication} ${fmtSlot(d.slot)} as taken` : `${d.medication} ${fmtSlot(d.slot)} ${d.status}`}
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 transition ${done ? 'border-ok bg-ok text-white' : open ? 'border-line text-transparent hover:border-ok hover:text-ok' : 'border-line bg-bg2 text-muted'}`}>
                  {done ? <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400 }}><Check size={18} /></motion.span> : open ? <Check size={18} /> : <Pill size={15} />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-sm font-semibold ${done ? 'text-muted line-through decoration-ok/50' : ''}`}>{d.medication} <span className="font-normal text-muted">{d.dose}</span></div>
                  <div className="flex items-center gap-1.5 text-xs text-muted">{fmtSlot(d.slot)} · {d.purpose}{d.with_food && <Utensils size={11} aria-label="with food" />}</div>
                </div>
                <Badge kind={d.status} />
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ol>
    </Card>
  )
}
