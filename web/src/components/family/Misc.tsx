import { AnimatePresence, motion } from 'framer-motion'
import { BellRing, Brain, CalendarDays, Car, FlaskConical, MapPin, X } from 'lucide-react'
import { useEffect } from 'react'
import { fmtTime } from '../../lib/format'
import { useCare } from '../../state/care'
import { Avatar, Badge, Button, Card, SectionTitle } from '../ui/primitives'

export function Appointments() {
  const { snap } = useCare()
  const items = snap?.next_appointments ?? []
  return (
    <Card data-testid="appointments">
      <SectionTitle>Coming up</SectionTitle>
      {items.length === 0 ? <p className="py-4 text-sm text-muted">Nothing scheduled. Ask Alexa to book something.</p> : (
        <ul className="space-y-3">
          {items.map((a) => {
            const d = new Date(a.starts_at)
            return (
              <li key={a.id} className="flex gap-3">
                <div className="grid h-14 w-12 shrink-0 place-items-center rounded-2xl bg-bg2 text-center leading-none">
                  <div><div className="text-xl font-bold">{d.getDate()}</div><div className="mt-0.5 text-[10px] uppercase text-muted">{d.toLocaleDateString([], { month: 'short' })}</div></div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="truncate text-sm font-semibold">{a.title}</span>{!!a.needs_ride && <Badge kind="high"><Car size={11} />ride</Badge>}</div>
                  <div className="text-xs text-muted">{fmtTime(a.starts_at)}{a.doctor ? ` · ${a.doctor}` : ''}</div>
                  {a.location && <div className="flex items-center gap-1 text-xs text-muted"><MapPin size={11} />{a.location}</div>}
                  {a.notes && <div className="mt-0.5 text-xs">{a.notes}</div>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

export function Circle() {
  const { snap } = useCare()
  return (
    <Card data-testid="circle">
      <SectionTitle>Family circle</SectionTitle>
      <ul className="mb-5 space-y-2.5">
        {(snap?.caregivers ?? []).map((c) => (
          <li key={c.id} className="flex items-center gap-3">
            <Avatar name={c.name} size={34} />
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{c.name}</div><div className="text-xs text-muted">{c.role === 'admin' ? 'Family admin' : 'Family'}</div></div>
            {c.notify_level && <Badge kind={c.notify_level === 'all' ? 'info' : 'upcoming'}>{c.notify_level === 'all' ? 'all updates' : 'urgent only'}</Badge>}
          </li>
        ))}
      </ul>
      <SectionTitle right={<Brain size={14} className="text-muted" />}>What CareCircle remembers</SectionTitle>
      <ul className="space-y-2">
        {(snap?.memories ?? []).map((m) => <li key={m.content} className="rounded-xl bg-bg2 px-3 py-2 text-[13px] leading-snug">{m.content}</li>)}
      </ul>
    </Card>
  )
}

export function ScenarioPanel() {
  const { setScenario, can } = useCare()
  if (!can('demo:reset')) return null
  const opts: { id: 'decline' | 'stable' | 'fresh'; label: string; hint: string }[] = [
    { id: 'decline', label: 'Quiet decline', hint: 'Mood, sleep and doses slip over 3 days' },
    { id: 'stable', label: 'Steady week', hint: 'Healthy history, nothing to flag' },
    { id: 'fresh', label: 'New family', hint: 'Profile only, no history' },
  ]
  return (
    <Card data-testid="scenarios">
      <SectionTitle right={<FlaskConical size={14} className="text-muted" />}>Demo scenarios</SectionTitle>
      <div className="space-y-2">
        {opts.map((o) => (
          <Button key={o.id} className="w-full !justify-start text-left" onClick={() => setScenario(o.id)}>
            <span><span className="block">{o.label}</span><span className="block text-[11px] font-normal text-muted">{o.hint}</span></span>
          </Button>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted">All data is synthetic. Switching resets the record and conversations.</p>
    </Card>
  )
}

/** Phone-style push notification shown to family when an urgent alert is raised. */
export function PushToasts() {
  const { toasts, dismissToast } = useCare()
  useEffect(() => {
    const timers = toasts.map((t) => setTimeout(() => dismissToast(t.id), 9000))
    return () => timers.forEach(clearTimeout)
  }, [toasts, dismissToast])
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-3" aria-live="assertive">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} layout initial={{ opacity: 0, y: -30, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 80 }}
            className="pointer-events-auto rounded-3xl border border-line bg-surface/95 p-4 shadow-[var(--shadow-lg)] backdrop-blur" role="status" data-testid="push-toast">
            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
              <span className="grid h-5 w-5 place-items-center rounded-md bg-brand text-[var(--brand-ink)]"><BellRing size={12} /></span>CareCircle · now
              <button onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="ml-auto text-muted hover:text-ink"><X size={14} /></button>
            </div>
            <div className="flex items-start gap-2"><Badge kind={t.alert.severity} /><div className="text-sm font-semibold leading-snug">{t.alert.title}</div></div>
            <p className="mt-1 line-clamp-3 text-[13px] leading-snug text-muted">{t.alert.detail}</p>
            {t.alert.notified && <p className="mt-2 text-[11px] text-muted">Sent to {t.alert.notified}</p>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export { CalendarDays }
