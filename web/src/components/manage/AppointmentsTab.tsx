import { CalendarPlus, Car, Pencil } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../../lib/api'
import { fmtDay, fmtTime } from '../../lib/format'
import type { AdminAppointment, AdminOverview } from '../../lib/types'
import { useCare } from '../../state/care'
import { Badge, Button, Card, SectionTitle } from '../ui/primitives'
import { Field, Messages, Select, TextInput, TwoTap, useAction } from './ui'

const local = (iso: string) => iso.slice(0, 16)

function Row({ a, ov, reload }: { a: AdminAppointment; ov: AdminOverview; reload: () => Promise<void> }) {
  const [edit, setEdit] = useState(false)
  const [f, setF] = useState({ title: a.title, starts_at: local(a.starts_at), location: a.location ?? '', needs_ride: !!a.needs_ride, notes: a.notes ?? '', doctor: a.doctor ?? '', facility_id: a.facility_id ? String(a.facility_id) : '' })
  const act = useAction(reload)
  const save = (e: FormEvent) => { e.preventDefault(); act.run(async () => { await api.admin.updateAppointment(a.id, { ...f, starts_at: f.starts_at + ':00', facility_id: f.facility_id ? Number(f.facility_id) : null }); setEdit(false) }, 'Appointment updated') }
  return (
    <li className="rounded-2xl border border-line p-3" data-testid={`appt-${a.id}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[160px] flex-1"><div className="text-sm font-semibold">{a.title}{!!a.needs_ride && <Badge kind="high" className="ml-2"><Car size={11} />ride</Badge>}</div>
          <div className="text-xs text-muted">{fmtDay(a.starts_at)} · {fmtTime(a.starts_at)}{a.doctor ? ` · ${a.doctor}` : ''}{a.location ? ` · ${a.location}` : ''}</div></div>
        <Button size="sm" onClick={() => setEdit((e) => !e)} aria-label={`Edit ${a.title}`}><Pencil size={13} />Edit</Button>
        <TwoTap label="Cancel" confirmLabel="Confirm cancel" onConfirm={() => act.run(() => api.admin.cancelAppointment(a.id), `${a.title} cancelled`)} />
      </div>
      {edit && (
        <form onSubmit={save} className="mt-3 grid gap-3 sm:grid-cols-2" aria-label={`Edit ${a.title}`}>
          <Field label="Title"><TextInput value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></Field>
          <Field label="When"><TextInput type="datetime-local" value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} required /></Field>
          <Field label="Facility"><Select value={f.facility_id} onChange={(e) => setF({ ...f, facility_id: e.target.value })}><option value="">None</option>{ov.facilities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
          <Field label="Location / notes"><TextInput value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.needs_ride} onChange={(e) => setF({ ...f, needs_ride: e.target.checked })} />A ride is needed</label>
          <div className="flex justify-end"><Button variant="primary" disabled={act.busy}>Save</Button></div>
        </form>
      )}
      <div className="mt-2 space-y-1.5"><Messages a={act} /></div>
    </li>
  )
}

export function AppointmentsTab({ ov, reload }: { ov: AdminOverview; reload: () => Promise<void> }) {
  const { refresh } = useCare()
  const after = async () => { await reload(); await refresh() }
  const active = ov.patients.filter((p) => p.active)
  const [pid, setPid] = useState(active[0]?.id ?? '')
  const empty = { title: '', starts_at: '', doctor: '', location: '', needs_ride: false, notes: '', facility_id: '' }
  const [f, setF] = useState(empty)
  const act = useAction(after)
  const p = active.find((x) => x.id === pid) ?? active[0]
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]" data-testid="appointments-tab">
      <Card>
        <SectionTitle>Upcoming appointments</SectionTitle>
        <div role="tablist" aria-label="Patient" className="mb-3 flex flex-wrap gap-2">{active.map((x) => <button key={x.id} role="tab" aria-selected={x.id === p?.id} onClick={() => setPid(x.id)} className={`rounded-full border px-3 py-1 text-sm transition ${x.id === p?.id ? 'border-brand bg-brand text-[var(--brand-ink)]' : 'border-line bg-surface hover:bg-surface2'}`}>{x.name.split(' ')[0]}</button>)}</div>
        <ul className="space-y-2.5">{(p?.appointments ?? []).map((a) => <Row key={a.id} a={a} ov={ov} reload={after} />)}{(p?.appointments ?? []).length === 0 && <li className="text-sm text-muted">Nothing scheduled.</li>}</ul>
      </Card>
      <Card>
        <SectionTitle right={<CalendarPlus size={14} className="text-muted" />}>Add an appointment</SectionTitle>
        <form aria-label="Add an appointment" className="grid gap-3"
          onSubmit={(e) => { e.preventDefault(); act.run(async () => { await api.addAppointment(p!.id, { ...f, starts_at: f.starts_at + ':00', facility_id: f.facility_id ? Number(f.facility_id) : null }); setF(empty) }, `${f.title} booked for ${p!.name.split(' ')[0]}`) }}>
          <Field label="Title"><TextInput value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></Field>
          <Field label="When"><TextInput type="datetime-local" value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} required /></Field>
          <Field label="Doctor"><TextInput value={f.doctor} onChange={(e) => setF({ ...f, doctor: e.target.value })} /></Field>
          <Field label="Facility"><Select value={f.facility_id} onChange={(e) => setF({ ...f, facility_id: e.target.value })}><option value="">None</option>{ov.facilities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.needs_ride} onChange={(e) => setF({ ...f, needs_ride: e.target.checked })} />A ride is needed</label>
          <Button variant="primary" disabled={act.busy || !p}>Book appointment</Button>
          <Messages a={act} />
        </form>
      </Card>
    </div>
  )
}
