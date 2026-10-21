import { Building2, CalendarDays, ClipboardList, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import type { AdminOverview } from '../../lib/types'
import { Card, Skeleton } from '../ui/primitives'
import { AppointmentsTab } from './AppointmentsTab'
import { CarePlanTab } from './CarePlanTab'
import { FacilitiesTab } from './FacilitiesTab'
import { PeopleTab } from './PeopleTab'

const TABS = [
  { id: 'people', label: 'People', icon: Users },
  { id: 'care', label: 'Care plan & medicines', icon: ClipboardList },
  { id: 'appts', label: 'Appointments', icon: CalendarDays },
  { id: 'facilities', label: 'Facilities', icon: Building2 },
] as const

/** Family-admin console. Everything here is scoped to the admin's own family on the server; the UI is only a convenience. */
export function ManageConsole() {
  const [ov, setOv] = useState<AdminOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('people')
  const reload = useCallback(async () => {
    try { setOv(await api.admin.overview()); setError(null) } catch (e) { setError((e as Error).message) }
  }, [])
  useEffect(() => { reload() }, [reload])

  if (error && !ov) return <p role="alert" className="rounded-2xl bg-urgent-soft px-4 py-3 text-sm text-urgent">{error}</p>
  if (!ov) return <div className="space-y-4"><Skeleton className="h-16" /><Skeleton className="h-72" /></div>
  return (
    <div className="space-y-4" data-testid="manage-console">
      <Card className="flex flex-wrap items-center gap-4">
        <div className="min-w-[220px] flex-1">
          <h2 className="font-display text-3xl">{ov.family.name}</h2>
          <p className="text-sm text-muted">{ov.family.city} · {ov.patients.filter((p) => p.active).length} patients · {ov.members.filter((m) => m.active).length} people. Changes apply immediately and are recorded in the audit log.</p>
        </div>
        <nav role="tablist" aria-label="Manage" className="flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold transition ${tab === t.id ? 'bg-brand text-[var(--brand-ink)]' : 'border border-line bg-surface text-muted hover:text-ink'}`}>
              <t.icon size={15} />{t.label}
            </button>
          ))}
        </nav>
      </Card>
      {tab === 'people' && <PeopleTab ov={ov} reload={reload} />}
      {tab === 'care' && <CarePlanTab ov={ov} reload={reload} />}
      {tab === 'appts' && <AppointmentsTab ov={ov} reload={reload} />}
      {tab === 'facilities' && <FacilitiesTab ov={ov} reload={reload} />}
    </div>
  )
}
