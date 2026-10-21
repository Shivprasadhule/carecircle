import { AnimatePresence, motion } from 'framer-motion'
import { Brain, CalendarDays, Check, Loader2, MapPin, Pill, ShieldAlert, Sparkles, Car, Moon, Activity } from 'lucide-react'
import type { ReactNode } from 'react'
import { fmtDay, fmtSlot, fmtTime, moodFace, titleCase } from '../../lib/format'
import type { Appointment, Dose, ToolCall } from '../../lib/types'
import { Avatar } from '../ui/primitives'
import { toolLabel } from './toolMeta'

const base = 'relative w-[230px] shrink-0 snap-start overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[.09] to-white/[.04] p-4 text-white'
const kicker = 'mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-200/70'
const DOSE_TONE: Record<string, string> = {
  taken: 'bg-emerald-400/15 text-emerald-300', missed: 'bg-rose-400/15 text-rose-300', overdue: 'bg-rose-400/15 text-rose-300',
  due: 'bg-amber-400/15 text-amber-300', skipped: 'bg-white/10 text-white/60', upcoming: 'bg-sky-400/15 text-sky-200',
}

function Shell({ children, k }: { children: ReactNode; k: string }) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 24 }} className={base} data-testid={`card-${k}`}>
      {children}
    </motion.div>
  )
}

function Ring({ value, total }: { value: number; total: number }) {
  const r = 22, c = 2 * Math.PI * r, pct = total ? value / total : 0
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
      <circle cx="28" cy="28" r={r} stroke="rgba(255,255,255,.12)" strokeWidth="6" fill="none" />
      <motion.circle cx="28" cy="28" r={r} stroke="#34d399" strokeWidth="6" fill="none" strokeLinecap="round" transform="rotate(-90 28 28)"
        strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - pct) }} transition={{ duration: 0.9, ease: 'easeOut' }} />
      <text x="28" y="32" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">{value}/{total}</text>
    </svg>
  )
}

export function DosesCard({ doses }: { doses: Dose[] }) {
  const taken = doses.filter((d) => d.status === 'taken').length
  return (
    <Shell k="doses">
      <div className={kicker}><Pill size={12} /> Today's medicines</div>
      <div className="flex items-center gap-3">
        <Ring value={taken} total={doses.length} />
        <div className="text-sm font-semibold leading-tight">{taken === doses.length ? 'All done' : `${doses.length - taken} still to go`}</div>
      </div>
      <ul className="mt-3 space-y-1.5 text-[13px]">
        {doses.slice(0, 5).map((d) => (
          <li key={d.med_id + d.slot} className="flex items-center justify-between gap-2">
            <span className="truncate text-white/85">{d.medication} <span className="text-white/45">{fmtSlot(d.slot)}</span></span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${DOSE_TONE[d.status]}`}>{d.status}</span>
          </li>
        ))}
      </ul>
    </Shell>
  )
}

function DoseLogged({ r }: { r: any }) {
  const ok = r.ok !== false
  return (
    <Shell k="dose-logged">
      <div className={kicker}><Pill size={12} /> Medicine logged</div>
      <div className="flex items-center gap-3">
        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.15 }} className={`grid h-11 w-11 place-items-center rounded-full ${ok ? 'bg-emerald-400/20 text-emerald-300' : 'bg-rose-400/20 text-rose-300'}`}>
          <Check size={22} />
        </motion.span>
        <div>
          <div className="text-base font-semibold">{r.medication}</div>
          <div className="text-xs text-white/60">{r.dose} · {r.slot && fmtSlot(r.slot)} · <span className="capitalize">{r.status}</span></div>
        </div>
      </div>
      {r.with_food && <div className="mt-3 rounded-lg bg-white/[.06] px-2.5 py-1.5 text-[11px] text-white/70">Best taken with food</div>}
    </Shell>
  )
}

function Gauge({ label, value, max, color, icon }: { label: string; value: number | null; max: number; color: string; icon: ReactNode }) {
  const pct = value == null ? 0 : Math.min(100, (value / max) * 100)
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-white/60"><span className="flex items-center gap-1">{icon}{label}</span><span className="font-semibold text-white/90">{value ?? '–'}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8 }} /></div>
    </div>
  )
}

function CheckinCard({ r }: { r: any }) {
  return (
    <Shell k="checkin">
      <div className={kicker}><Activity size={12} /> Check-in saved</div>
      <div className="mb-3 flex items-center gap-3">
        <span className="text-4xl leading-none">{moodFace(r.mood)}</span>
        <div className="text-sm font-semibold">Mood {r.mood}/5</div>
      </div>
      <div className="space-y-2">
        <Gauge label="Sleep (h)" value={r.sleep_hours} max={9} color="#a78bfa" icon={<Moon size={11} />} />
        <Gauge label="Pain" value={r.pain} max={10} color="#fb923c" icon={<Activity size={11} />} />
      </div>
    </Shell>
  )
}

export function ApptCard({ a, label = 'Appointment' }: { a: Pick<Appointment, 'title' | 'starts_at' | 'location' | 'needs_ride'> & { doctor?: string | null }; label?: string }) {
  const d = new Date(a.starts_at)
  return (
    <Shell k="appointment">
      <div className={kicker}><CalendarDays size={12} /> {label}</div>
      <div className="flex gap-3">
        <div className="grid h-14 w-12 shrink-0 place-items-center rounded-xl bg-white/10 text-center leading-none">
          <div><div className="text-xl font-bold">{d.getDate()}</div><div className="mt-0.5 text-[10px] uppercase text-white/60">{d.toLocaleDateString([], { month: 'short' })}</div></div>
        </div>
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{a.title}</div>
          <div className="text-xs text-white/60">{fmtDay(a.starts_at)} · {fmtTime(a.starts_at)}</div>
          {a.location && <div className="mt-1 flex items-center gap-1 truncate text-xs text-white/60"><MapPin size={11} />{a.location}</div>}
        </div>
      </div>
      {!!a.needs_ride && <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-amber-400/15 px-2.5 py-1.5 text-[11px] font-medium text-amber-200"><Car size={12} /> A ride is needed</div>}
    </Shell>
  )
}

function AlertSent({ a }: { a: any }) {
  const names = String(a.notified || '').split(',').map((s) => s.trim()).filter(Boolean)
  return (
    <Shell k="alert">
      <div className={kicker}><ShieldAlert size={12} /> Family notified</div>
      <div className="mb-2 text-sm font-semibold leading-snug">{a.title}</div>
      <div className="flex items-center">
        {names.slice(0, 4).map((n, i) => (
          <Avatar key={n} name={n} size={28} className={`ring-2 ring-[#10192c] ${i ? '-ml-2' : ''}`} />
        ))}
        <span className="ml-2 text-[11px] text-white/60">{names.length} notified</span>
      </div>
    </Shell>
  )
}

function TrendsCard({ r }: { r: any }) {
  const s = r.signals ?? {}
  const tone = s.level === 'ok' ? 'text-emerald-300' : s.level === 'watch' ? 'text-amber-300' : 'text-rose-300'
  return (
    <Shell k="trends">
      <div className={kicker}><Sparkles size={12} /> Last few days</div>
      <div className={`mb-2 text-base font-semibold capitalize ${tone}`}>{s.level === 'ok' ? 'Looking steady' : `${s.level} level`}</div>
      <div className="flex flex-wrap gap-1.5">
        {(s.signals ?? []).slice(0, 4).map((x: any) => <span key={x.signal} className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/80">{titleCase(x.signal)}</span>)}
        {!(s.signals ?? []).length && <span className="text-xs text-white/60">No concerning patterns.</span>}
      </div>
    </Shell>
  )
}

function RememberedCard({ text }: { text: string }) {
  return (
    <Shell k="remembered">
      <div className={kicker}><Brain size={12} /> I'll remember that</div>
      <div className="text-[13px] leading-snug text-white/85">{text}</div>
    </Shell>
  )
}

/** Turn finished tool calls into cards. De-duplicates so one reply never shows two of the same card. */
export function cardsFor(calls: ToolCall[]): ReactNode[] {
  const out: ReactNode[] = []
  const seen = new Set<string>()
  const once = (k: string, node: () => ReactNode) => { if (!seen.has(k)) { seen.add(k); out.push(node()) } }
  for (const c of calls) {
    if (c.status !== 'success' || !c.result) continue
    const r = c.result
    switch (c.tool) {
      case 'log_dose': if (r.ok) out.push(<DoseLogged key={c.id} r={r} />); break
      case 'record_checkin': if (r.ok) out.push(<CheckinCard key={c.id} r={r} />); break
      case 'list_todays_doses': case 'get_care_snapshot': {
        const doses: Dose[] = r.doses ?? r.doses_today ?? []
        if (doses.length) once('doses', () => <DosesCard key={c.id + 'd'} doses={doses} />)
        if (c.tool === 'get_care_snapshot') (r.next_appointments ?? []).slice(0, 1).forEach((a: Appointment) => once('appt' + a.id, () => <ApptCard key={c.id + 'a' + a.id} a={a} label="Next up" />))
        break
      }
      case 'list_appointments': (r.appointments ?? []).slice(0, 3).forEach((a: Appointment) => once('appt' + a.id, () => <ApptCard key={c.id + a.id} a={a} />)); break
      case 'schedule_appointment': if (r.ok) out.push(<ApptCard key={c.id} a={r} label="Booked" />); break
      case 'raise_family_alert': if (r.alert) out.push(<AlertSent key={c.id} a={r.alert} />); break
      case 'analyze_wellbeing_trends': out.push(<TrendsCard key={c.id} r={r} />); break
      case 'remember': if (r.ok) out.push(<RememberedCard key={c.id} text={String(c.input?.content ?? r.remembered ?? '')} />); break
    }
  }
  return out
}

export function ToolStatus({ calls }: { calls: ToolCall[] }) {
  const running = calls.filter((c) => c.status === 'running')
  return (
    <AnimatePresence initial={false}>
      {running.map((c) => (
        <motion.div key={c.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
          <div className="mb-1.5 flex items-center gap-2 text-xs text-sky-200/80"><Loader2 size={13} className="animate-spin" />{toolLabel(c.tool)}…</div>
        </motion.div>
      ))}
    </AnimatePresence>
  )
}
