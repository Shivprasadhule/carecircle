import { Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../../lib/api'
import { levelColor } from '../../lib/format'
import type { Severity, VitalReading } from '../../lib/types'
import { useCare } from '../../state/care'
import { Button, Card, SectionTitle } from '../ui/primitives'
import { Sparkline } from './StatTiles'

const KINDS: { kind: string; label: string; unit: string; signals: string[] }[] = [
  { kind: 'bp', label: 'Blood pressure', unit: 'mmHg', signals: ['high_bp', 'very_high_bp', 'low_bp'] },
  { kind: 'glucose', label: 'Blood sugar', unit: 'mg/dL', signals: ['low_blood_sugar', 'high_blood_sugar'] },
  { kind: 'spo2', label: 'Oxygen', unit: '%', signals: ['low_oxygen', 'oxygen_trending_down'] },
  { kind: 'weight', label: 'Weight', unit: 'kg', signals: ['rapid_weight_gain', 'weight_rising'] },
  { kind: 'hr', label: 'Pulse', unit: 'bpm', signals: ['abnormal_heart_rate'] },
  { kind: 'inr', label: 'INR', unit: '', signals: ['inr_out_of_range'] },
]
const fmt = (kind: string, r: VitalReading) => (kind === 'bp' ? `${r.value}/${r.value2 ?? '–'}` : String(r.value))

/** Latest readings with a trend line, tinted when the signal engine flags them (low oxygen, rapid weight gain, a low sugar, etc.). */
export function VitalsPanel() {
  const { snap, can, patientId, refresh, refreshPatients } = useCare()
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState('bp')
  const [v1, setV1] = useState('')
  const [v2, setV2] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  if (!snap) return null
  const present = KINDS.filter((k) => snap.vitals[k.kind]?.length)
  const sev = (k: (typeof KINDS)[number]): Severity | null => {
    const hit = snap.signals.signals.filter((s) => k.signals.includes(s.signal)).map((s) => s.severity)
    return (['urgent', 'high', 'watch'] as Severity[]).find((s) => hit.includes(s)) ?? null
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null)
    try {
      await api.addVital(patientId!, kind, Number(v1), kind === 'bp' ? Number(v2) : undefined)
      setV1(''); setV2(''); setAdding(false); await refresh(); await refreshPatients()
    } catch (er) { setMsg((er as Error).message) }
  }
  return (
    <Card data-testid="vitals-panel">
      <SectionTitle right={can('vital:write') && <button onClick={() => setAdding((a) => !a)} aria-expanded={adding} className="flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-muted transition hover:bg-surface2"><Plus size={12} />Add reading</button>}>Vital signs</SectionTitle>
      {adding && (
        <form onSubmit={submit} className="mb-4 flex flex-wrap items-end gap-2 rounded-2xl bg-bg2 p-3" aria-label="Add a reading">
          <label className="text-xs font-medium">Reading
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1 block rounded-lg border border-line bg-surface px-2 py-1.5 text-sm">{KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select></label>
          <label className="text-xs font-medium">{kind === 'bp' ? 'Systolic' : 'Value'}<input inputMode="decimal" value={v1} onChange={(e) => setV1(e.target.value)} className="mt-1 block w-24 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" /></label>
          {kind === 'bp' && <label className="text-xs font-medium">Diastolic<input inputMode="decimal" value={v2} onChange={(e) => setV2(e.target.value)} className="mt-1 block w-24 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" /></label>}
          <Button size="sm" variant="primary" disabled={!v1}>Save</Button>
          {msg && <p role="alert" className="w-full text-xs text-urgent">{msg}</p>}
        </form>
      )}
      {present.length === 0 ? <p className="py-4 text-sm text-muted">No readings yet. Ask Alexa to record one: "my blood pressure is 130 over 80".</p> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {present.map((k) => {
            const series = snap.vitals[k.kind]
            const last = series[series.length - 1]
            const s = sev(k)
            const color = s ? levelColor(s) : 'var(--brand)'
            return (
              <div key={k.kind} className="rounded-2xl border p-3" style={{ borderColor: s ? color : 'var(--line)', background: s ? `color-mix(in srgb, ${color} 7%, transparent)` : undefined }} data-testid={`vital-${k.kind}`}>
                <div className="flex items-center justify-between text-xs text-muted"><span>{k.label}</span>{s && <span className="font-semibold capitalize" style={{ color }}>{s === 'watch' ? 'watch' : s}</span>}</div>
                <div className="mt-1 flex items-end justify-between gap-2">
                  <div><span className="font-display text-2xl leading-none">{fmt(k.kind, last)}</span><span className="ml-1 text-xs text-muted">{k.unit}</span></div>
                  <Sparkline values={series.map((r) => r.value)} color={color} width={80} height={28} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
