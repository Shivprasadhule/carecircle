import { Building2, ClipboardList, Phone, Pill, ShieldAlert, Stethoscope, Utensils } from 'lucide-react'
import { fmtSlot } from '../../lib/format'
import { useCare } from '../../state/care'
import { Badge, Card, SectionTitle } from '../ui/primitives'

/** The patient's care plan: standing instructions from family and clinicians, allergies, where they are cared for, and their medicines. */
export function CarePlan() {
  const { snap } = useCare()
  if (!snap) return null
  const p = snap.person
  return (
    <Card data-testid="care-plan">
      <SectionTitle right={<ClipboardList size={14} className="text-muted" />}>Care plan</SectionTitle>
      <div className="mb-4 rounded-2xl border border-brand/30 bg-brand/5 p-3.5" data-testid="care-instructions">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-brand">Care instructions</div>
        <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{p.instructions || 'No instructions yet. A family admin can add them under Manage.'}</p>
      </div>
      <dl className="mb-4 space-y-2 text-sm">
        <div className="flex gap-2"><dt className="mt-0.5 text-muted"><ShieldAlert size={15} aria-label="Allergies" /></dt><dd><span className="font-medium">Allergies: </span>{p.allergies || 'None known'}</dd></div>
        {p.facility_name && (
          <div className="flex gap-2"><dt className="mt-0.5 text-muted"><Building2 size={15} aria-label="Facility" /></dt>
            <dd><span className="font-medium">{p.facility_name}</span>{p.facility_kind && <span className="text-muted"> · {p.facility_kind}</span>}
              {p.facility_address && <span className="block text-xs text-muted">{p.facility_address}</span>}
              {p.facility_phone && <span className="flex items-center gap-1 text-xs text-muted"><Phone size={11} />{p.facility_phone}</span>}</dd></div>
        )}
        {snap.clinicians.length > 0 && (
          <div className="flex gap-2"><dt className="mt-0.5 text-muted"><Stethoscope size={15} aria-label="Clinicians" /></dt><dd>{snap.clinicians.map((c) => <span key={c.id} className="mr-2 inline-block"><b>{c.name}</b> <span className="text-xs text-muted">{c.blurb}</span></span>)}</dd></div>
        )}
      </dl>
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted"><Pill size={13} />Medicines</h4>
      <ul className="divide-y divide-line text-sm" data-testid="medicine-list">
        {snap.medications.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
            <span className="min-w-[120px] flex-1"><b>{m.name}</b> <span className="text-muted">{m.dose}</span>{!!m.with_food && <Utensils size={11} className="ml-1 inline text-muted" aria-label="with food" />}
              {m.purpose && <span className="block text-xs text-muted">{m.purpose}{m.prescriber ? ` · ${m.prescriber}` : ''}</span>}</span>
            <span className="flex flex-wrap gap-1">{m.times.split(',').map((t) => <Badge key={t} kind="upcoming">{fmtSlot(t)}</Badge>)}</span>
          </li>
        ))}
        {snap.medications.length === 0 && <li className="py-2 text-muted">No medicines listed.</li>}
      </ul>
    </Card>
  )
}
