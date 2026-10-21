import { Building2, Pencil } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../lib/api'
import type { AdminOverview, Facility } from '../../lib/types'
import { useCare } from '../../state/care'
import { Badge, Button, Card, SectionTitle } from '../ui/primitives'
import { Field, Messages, Select, TextInput, TwoTap, useAction } from './ui'

const KINDS = ['clinic', 'hospital', 'care home', 'day care', 'pharmacy', 'lab', 'home']

function Row({ f, ov, reload }: { f: Facility; ov: AdminOverview; reload: () => Promise<void> }) {
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState({ name: f.name, kind: f.kind, address: f.address ?? '', phone: f.phone ?? '' })
  const act = useAction(reload)
  const used = ov.patients.filter((p) => p.active && p.facility_id === f.id).map((p) => p.name.split(' ')[0])
  return (
    <li className="rounded-2xl border border-line p-3" data-testid={`facility-${f.id}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[180px] flex-1"><div className="text-sm font-semibold">{f.name} <Badge kind="upcoming">{f.kind}</Badge></div>
          <div className="text-xs text-muted">{f.address}{f.phone ? ` · ${f.phone}` : ''}{used.length ? ` · used by ${used.join(', ')}` : ''}</div></div>
        <Button size="sm" onClick={() => setEdit((e) => !e)} aria-label={`Edit ${f.name}`}><Pencil size={13} />Edit</Button>
        <TwoTap label="Remove" onConfirm={() => act.run(() => api.admin.removeFacility(f.id), `${f.name} removed`)} />
      </div>
      {edit && (
        <form className="mt-3 grid gap-3 sm:grid-cols-2" aria-label={`Edit ${f.name}`} onSubmit={(e) => { e.preventDefault(); act.run(async () => { await api.admin.updateFacility(f.id, v); setEdit(false) }, 'Facility updated') }}>
          <Field label="Name"><TextInput value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required /></Field>
          <Field label="Type"><Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</Select></Field>
          <Field label="Address"><TextInput value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /></Field>
          <Field label="Phone"><TextInput value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
          <div className="flex justify-end sm:col-span-2"><Button variant="primary" disabled={act.busy}>Save</Button></div>
        </form>
      )}
      <div className="mt-2 space-y-1.5"><Messages a={act} /></div>
    </li>
  )
}

export function FacilitiesTab({ ov, reload }: { ov: AdminOverview; reload: () => Promise<void> }) {
  const { refresh } = useCare()
  const after = async () => { await reload(); await refresh() }
  const empty = { name: '', kind: 'clinic', address: '', phone: '' }
  const [f, setF] = useState(empty)
  const act = useAction(after)
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]" data-testid="facilities-tab">
      <Card><SectionTitle>Facilities</SectionTitle><ul className="space-y-2.5">{ov.facilities.map((x) => <Row key={x.id} f={x} ov={ov} reload={after} />)}{ov.facilities.length === 0 && <li className="text-sm text-muted">No facilities yet.</li>}</ul></Card>
      <Card>
        <SectionTitle right={<Building2 size={14} className="text-muted" />}>Add a facility</SectionTitle>
        <form aria-label="Add a facility" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); act.run(async () => { await api.admin.addFacility(f); setF(empty) }, `${f.name} added`) }}>
          <Field label="Name"><TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
          <Field label="Type"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</Select></Field>
          <Field label="Address"><TextInput value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label="Phone"><TextInput value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Button variant="primary" disabled={act.busy}>Add facility</Button>
          <Messages a={act} />
        </form>
      </Card>
    </div>
  )
}
