import { KeyRound, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../../lib/api'
import type { AdminOverview, Member } from '../../lib/types'
import { useCare } from '../../state/care'
import { ROLE_LABEL } from '../SignIn'
import { Avatar, Badge, Button, Card, SectionTitle } from '../ui/primitives'
import { Field, Messages, Select, TextInput, TwoTap, useAction } from './ui'

function MemberRow({ m, ov, reload, me }: { m: Member; ov: AdminOverview; reload: () => Promise<void>; me: string }) {
  const act = useAction(reload)
  const [pw, setPw] = useState('')
  const [open, setOpen] = useState(false)
  const patient = ov.patients.find((p) => p.id === m.patient_id)
  return (
    <li className={`rounded-2xl border border-line p-3 ${m.active ? '' : 'opacity-55'}`} data-testid={`member-${m.id}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={m.name} size={38} />
        <div className="min-w-[150px] flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">{m.name}{m.id === me && <Badge kind="info">you</Badge>}<Badge kind={m.role === 'admin' ? 'watch' : m.role === 'person' ? 'ok' : 'info'}>{ROLE_LABEL[m.role]}</Badge>{!m.active && <Badge kind="missed">removed</Badge>}</div>
          <div className="text-xs text-muted">@{m.id}{patient ? ` · patient: ${patient.name}` : ''}{m.phone ? ` · ${m.phone}` : ''}</div>
        </div>
        {m.active ? (
          <div className="flex flex-wrap items-center gap-2">
            {m.role !== 'person' && (
              <Select aria-label={`Role of ${m.name}`} value={m.role} className="!mt-0 !w-auto !py-1.5" onChange={(e) => act.run(() => api.admin.updateMember(m.id, { role: e.target.value }), `${m.name} is now ${ROLE_LABEL[e.target.value as 'family']}`)}>
                <option value="family">Family member</option><option value="admin">Family admin</option>
              </Select>
            )}
            <Select aria-label={`Alerts for ${m.name}`} value={m.notify_level} className="!mt-0 !w-auto !py-1.5" onChange={(e) => act.run(() => api.admin.updateMember(m.id, { notify_level: e.target.value }), `${m.name} now gets ${e.target.value === 'all' ? 'all updates' : 'urgent alerts only'}`)}>
              <option value="all">All updates</option><option value="urgent">Urgent only</option>
            </Select>
            <Button size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}><KeyRound size={13} />Password</Button>
            <TwoTap label="Remove" onConfirm={() => act.run(() => api.admin.removeMember(m.id), `${m.name} was removed and signed out`)} />
          </div>
        ) : (
          <Button size="sm" onClick={() => act.run(() => api.admin.updateMember(m.id, { active: true }), `${m.name} was restored`)}>Restore</Button>
        )}
      </div>
      {open && (
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); act.run(() => api.admin.updateMember(m.id, { new_password: pw }), `New password set for ${m.name}`).then(() => { setPw(''); setOpen(false) }) }}>
          <Field label={`New password for ${m.name}`}><TextInput type="text" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} autoComplete="off" /></Field>
          <Button size="sm" variant="primary" disabled={pw.length < 8}>Set password</Button>
        </form>
      )}
      <div className="mt-2 space-y-1.5"><Messages a={act} /></div>
    </li>
  )
}

function AddMember({ ov, reload }: { ov: AdminOverview; reload: () => Promise<void> }) {
  const empty = { name: '', username: '', role: 'family', phone: '', notify_level: 'urgent', password: '', patient_id: '' }
  const [f, setF] = useState(empty)
  const act = useAction(reload)
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    act.run(async () => { await api.admin.addMember({ ...f, phone: f.phone || null, patient_id: f.role === 'person' ? f.patient_id : null }); setF(empty) }, `${f.name} was added. They can sign in as @${f.username}.`)
  }
  const patientsWithoutAccount = ov.patients.filter((p) => p.active && !ov.members.some((m) => m.patient_id === p.id && m.active))
  return (
    <Card>
      <SectionTitle right={<UserPlus size={14} className="text-muted" />}>Add a person</SectionTitle>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" aria-label="Add a person">
        <Field label="Full name"><TextInput value={f.name} onChange={set('name')} required maxLength={80} /></Field>
        <Field label="Username" hint="3-30 letters, digits, dot, dash or underscore"><TextInput value={f.username} onChange={set('username')} required autoCapitalize="none" /></Field>
        <Field label="Role">
          <Select value={f.role} onChange={set('role')}>
            <option value="family">Family member</option><option value="admin">Family admin</option>
            <option value="person" disabled={patientsWithoutAccount.length === 0}>Patient (own Alexa account)</option>
          </Select>
        </Field>
        {f.role === 'person'
          ? <Field label="Which patient"><Select value={f.patient_id} onChange={set('patient_id')} required><option value="">Choose…</option>{patientsWithoutAccount.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          : <Field label="Alerts"><Select value={f.notify_level} onChange={set('notify_level')}><option value="urgent">Urgent only</option><option value="all">All updates</option></Select></Field>}
        <Field label="Phone"><TextInput value={f.phone} onChange={set('phone')} placeholder="+91…" maxLength={30} /></Field>
        <Field label="Temporary password" hint="At least 8 characters. Share it with them privately."><TextInput value={f.password} onChange={set('password')} required minLength={8} autoComplete="off" /></Field>
        <div className="flex items-end sm:col-span-2"><Button variant="primary" disabled={act.busy}>Add person</Button></div>
        <div className="space-y-1.5 sm:col-span-2"><Messages a={act} /></div>
      </form>
    </Card>
  )
}

export function PeopleTab({ ov, reload }: { ov: AdminOverview; reload: () => Promise<void> }) {
  const { sessions, refreshPatients } = useCare()
  const after = async () => { await reload(); await refreshPatients() }
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]" data-testid="people-tab">
      <Card>
        <SectionTitle>{ov.family.name} · {ov.members.filter((m) => m.active).length} people</SectionTitle>
        <ul className="space-y-2.5">{ov.members.map((m) => <MemberRow key={m.id} m={m} ov={ov} reload={after} me={sessions.viewer?.user.id ?? ''} />)}</ul>
      </Card>
      <AddMember ov={ov} reload={after} />
    </div>
  )
}
