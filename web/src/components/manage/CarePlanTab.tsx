import { Pencil, Pill, Plus, UserRoundPlus } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../../lib/api'
import { fmtSlot } from '../../lib/format'
import { LANGUAGES } from '../../lib/languages'
import type { AdminOverview, AdminPatient, Medication } from '../../lib/types'
import { useCare } from '../../state/care'
import { Badge, Button, Card, SectionTitle } from '../ui/primitives'
import { Field, Messages, Select, TextArea, TextInput, TwoTap, useAction } from './ui'
import { PrescriptionScanner } from './PrescriptionScanner'

const MAX_INSTRUCTIONS = 2000

function MedicineRow({ m, reload }: { m: Medication; reload: () => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [f, setF] = useState({ dose: m.dose, times: m.times, purpose: m.purpose ?? '', notes: m.notes ?? '', prescriber: m.prescriber ?? '', with_food: !!m.with_food })
  const act = useAction(reload)
  const save = (e: FormEvent) => { e.preventDefault(); act.run(async () => { await api.admin.updateMedication(m.id, f); setEditing(false) }, `${m.name} updated`) }
  return (
    <li className={`rounded-2xl border border-line p-3 ${m.active ? '' : 'opacity-50'}`} data-testid={`med-${m.id}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[160px] flex-1">
          <div className="text-sm font-semibold">{m.name} <span className="font-normal text-muted">{m.dose}</span>{!m.active && <Badge kind="skipped" className="ml-2">stopped</Badge>}</div>
          <div className="text-xs text-muted">{m.purpose}{m.prescriber ? ` · ${m.prescriber}` : ''}{m.with_food ? ' · with food' : ''}</div>
          {m.notes && <div className="text-xs">{m.notes}</div>}
        </div>
        <div className="flex flex-wrap gap-1">{m.times.split(',').map((t) => <Badge key={t} kind="upcoming">{fmtSlot(t)}</Badge>)}</div>
        {m.active && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setEditing((e) => !e)} aria-label={`Edit ${m.name}`} aria-expanded={editing}><Pencil size={13} />Edit</Button>
            <TwoTap label="Stop" confirmLabel="Confirm stop" onConfirm={() => act.run(() => api.admin.stopMedication(m.id), `${m.name} stopped`)} />
          </div>
        )}
      </div>
      {editing && (
        <form onSubmit={save} className="mt-3 grid gap-3 sm:grid-cols-2" aria-label={`Edit ${m.name}`}>
          <Field label="Dose"><TextInput value={f.dose} onChange={(e) => setF({ ...f, dose: e.target.value })} required /></Field>
          <Field label="Times" hint="HH:MM, comma separated"><TextInput value={f.times} onChange={(e) => setF({ ...f, times: e.target.value })} required /></Field>
          <Field label="Purpose"><TextInput value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></Field>
          <Field label="Prescriber"><TextInput value={f.prescriber} onChange={(e) => setF({ ...f, prescriber: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Instructions / notes"><TextInput value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.with_food} onChange={(e) => setF({ ...f, with_food: e.target.checked })} />Take with food</label>
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setEditing(false)}>Cancel</Button><Button variant="primary" disabled={act.busy}>Save changes</Button></div>
        </form>
      )}
      <div className="mt-2 space-y-1.5"><Messages a={act} /></div>
    </li>
  )
}

function AddMedicine({ pid, reload }: { pid: string; reload: () => Promise<void> }) {
  const empty = { name: '', dose: '', purpose: '', times: '08:00', notes: '', prescriber: '', with_food: false }
  const [f, setF] = useState(empty)
  const act = useAction(reload)
  return (
    <form aria-label="Add a medicine" className="grid gap-3 rounded-2xl bg-bg2 p-3 sm:grid-cols-2"
      onSubmit={(e) => { e.preventDefault(); act.run(async () => { await api.admin.addMedication(pid, f); setF(empty) }, `${f.name} added to the schedule`) }}>
      <Field label="Medicine"><TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
      <Field label="Dose"><TextInput value={f.dose} onChange={(e) => setF({ ...f, dose: e.target.value })} placeholder="e.g. 500 mg" required /></Field>
      <Field label="Times" hint="HH:MM, comma separated"><TextInput value={f.times} onChange={(e) => setF({ ...f, times: e.target.value })} required /></Field>
      <Field label="Purpose"><TextInput value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></Field>
      <Field label="Prescriber"><TextInput value={f.prescriber} onChange={(e) => setF({ ...f, prescriber: e.target.value })} /></Field>
      <Field label="Instructions / notes"><TextInput value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. Not within 4 hours of calcium" /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.with_food} onChange={(e) => setF({ ...f, with_food: e.target.checked })} />Take with food</label>
      <div className="flex justify-end"><Button variant="primary" disabled={act.busy}><Plus size={14} />Add medicine</Button></div>
      <div className="space-y-1.5 sm:col-span-2"><Messages a={act} /></div>
    </form>
  )
}

function PatientForm({ p, ov, reload }: { p: AdminPatient; ov: AdminOverview; reload: () => Promise<void> }) {
  const init = () => ({ name: p.name, age: String(p.age), sex: p.sex ?? '', language: p.language ?? 'en-IN', conditions: p.conditions, allergies: p.allergies ?? '', facility_id: p.facility_id ? String(p.facility_id) : '' })
  const [f, setF] = useState(init)
  const [ins, setIns] = useState(p.instructions ?? '')
  const a1 = useAction(reload)
  const a2 = useAction(reload)
  useEffect(() => { setF(init()); setIns(p.instructions ?? '') }, [p.id, p.name, p.age, p.conditions, p.allergies, p.facility_id, p.instructions, p.language, p.sex]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof ReturnType<typeof init>) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  return (
    <div className="space-y-4">
      <form aria-label="Patient details" className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => { e.preventDefault(); a1.run(() => api.admin.updatePatient(p.id, { ...f, age: Number(f.age), facility_id: f.facility_id ? Number(f.facility_id) : null }), 'Details saved') }}>
        <Field label="Name"><TextInput value={f.name} onChange={set('name')} required maxLength={80} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Age"><TextInput type="number" min={0} max={120} value={f.age} onChange={set('age')} required /></Field>
          <Field label="Sex"><Select value={f.sex} onChange={set('sex')}><option value="">–</option><option value="F">Female</option><option value="M">Male</option></Select></Field></div>
        <div className="sm:col-span-2"><Field label="Conditions"><TextInput value={f.conditions} onChange={set('conditions')} maxLength={300} /></Field></div>
        <Field label="Allergies"><TextInput value={f.allergies} onChange={set('allergies')} maxLength={200} /></Field>
        <Field label="Language Alexa speaks"><Select value={f.language} onChange={set('language')}>{LANGUAGES.filter((l) => l.code !== 'hi-Latn').map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</Select></Field>
        <div className="sm:col-span-2"><Field label="Facility (where they are cared for)"><Select value={f.facility_id} onChange={set('facility_id')}><option value="">None / at home</option>{ov.facilities.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.kind})</option>)}</Select></Field></div>
        <div className="flex justify-end sm:col-span-2"><Button variant="primary" disabled={a1.busy}>Save details</Button></div>
        <div className="space-y-1.5 sm:col-span-2"><Messages a={a1} /></div>
      </form>

      <form aria-label="Care instructions" onSubmit={(e) => { e.preventDefault(); a2.run(() => api.admin.updatePatient(p.id, { instructions: ins }), 'Instructions saved. Alexa follows them from the next message.') }}>
        <Field label="Care instructions" hint="Standing instructions for Alexa and the family: dose timing, diet, what to do for a low reading, who to call. Alexa follows these in every conversation.">
          <TextArea value={ins} onChange={(e) => setIns(e.target.value)} maxLength={MAX_INSTRUCTIONS} rows={6} />
        </Field>
        <div className="mt-2 flex items-center justify-between"><span className="text-xs text-muted">{ins.length}/{MAX_INSTRUCTIONS}</span><Button variant="primary" disabled={a2.busy || ins === (p.instructions ?? '')}>Save instructions</Button></div>
        <div className="mt-2 space-y-1.5"><Messages a={a2} /></div>
      </form>
    </div>
  )
}

function AddPatient({ ov, reload, onAdded }: { ov: AdminOverview; reload: () => Promise<void>; onAdded: (id: string) => void }) {
  const empty = { name: '', age: '', sex: 'F', conditions: '', allergies: '', language: 'en-IN', facility_id: '', instructions: '' }
  const [f, setF] = useState(empty)
  const act = useAction(reload)
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  return (
    <Card>
      <SectionTitle right={<UserRoundPlus size={14} className="text-muted" />}>Add a patient</SectionTitle>
      <form aria-label="Add a patient" className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => { e.preventDefault(); act.run(async () => { const r = await api.admin.addPatient({ ...f, age: Number(f.age), facility_id: f.facility_id ? Number(f.facility_id) : null }); setF(empty); onAdded(r.id) }, `${f.name} was added. Now add their medicines.`) }}>
        <Field label="Name"><TextInput value={f.name} onChange={set('name')} required maxLength={80} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Age"><TextInput type="number" min={0} max={120} value={f.age} onChange={set('age')} required /></Field>
          <Field label="Sex"><Select value={f.sex} onChange={set('sex')}><option value="F">Female</option><option value="M">Male</option></Select></Field></div>
        <div className="sm:col-span-2"><Field label="Conditions"><TextInput value={f.conditions} onChange={set('conditions')} /></Field></div>
        <Field label="Allergies"><TextInput value={f.allergies} onChange={set('allergies')} /></Field>
        <Field label="Facility"><Select value={f.facility_id} onChange={set('facility_id')}><option value="">None / at home</option>{ov.facilities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
        <div className="flex justify-end sm:col-span-2"><Button variant="primary" disabled={act.busy}>Add patient</Button></div>
        <div className="space-y-1.5 sm:col-span-2"><Messages a={act} /></div>
      </form>
    </Card>
  )
}

export function CarePlanTab({ ov, reload }: { ov: AdminOverview; reload: () => Promise<void> }) {
  const { refresh, refreshPatients } = useCare()
  const after = async () => { await reload(); await refresh(); await refreshPatients() }
  const active = ov.patients.filter((p) => p.active)
  const [pid, setPid] = useState(active[0]?.id ?? '')
  const p = ov.patients.find((x) => x.id === pid && x.active) ?? active[0]
  const arch = useAction(after)
  return (
    <div className="space-y-4" data-testid="careplan-tab">
      <div role="tablist" aria-label="Patient" className="flex flex-wrap gap-2">
        {active.map((x) => <button key={x.id} role="tab" aria-selected={x.id === p?.id} onClick={() => setPid(x.id)} className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${x.id === p?.id ? 'border-brand bg-brand text-[var(--brand-ink)]' : 'border-line bg-surface hover:bg-surface2'}`}>{x.name}</button>)}
      </div>
      {p ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card><SectionTitle>{p.name} · profile and instructions</SectionTitle><PatientForm key={p.id} p={p} ov={ov} reload={after} /></Card>
          <Card>
            <SectionTitle right={<Pill size={14} className="text-muted" />}>Medicines</SectionTitle>
            <ul className="mb-4 space-y-2.5">{p.medications.map((m) => <MedicineRow key={m.id} m={m} reload={after} />)}{p.medications.length === 0 && <li className="text-sm text-muted">No medicines yet.</li>}</ul>
            <PrescriptionScanner key={p.id} pid={p.id} patientName={p.name} reload={after} />
            <AddMedicine pid={p.id} reload={after} />
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p className="max-w-xs text-xs text-muted">Archiving removes {p.name.split(' ')[0]} from the family app and signs out their account. History is kept.</p>
              <TwoTap label={`Archive ${p.name.split(' ')[0]}`} confirmLabel="Confirm archive" onConfirm={() => arch.run(() => api.admin.archivePatient(p.id), `${p.name} was archived`)} />
            </div>
            <div className="mt-2 space-y-1.5"><Messages a={arch} /></div>
          </Card>
        </div>
      ) : <Card><p className="text-sm text-muted">No patients yet. Add one below.</p></Card>}
      <AddPatient ov={ov} reload={after} onAdded={setPid} />
    </div>
  )
}
