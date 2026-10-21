import { AlertTriangle, Camera, CheckCircle2, FileText, Loader2, ScanLine, ShieldAlert, Upload, X } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import { api } from '../../lib/api'
import { prepareUpload, UploadError } from '../../lib/image'
import type { RxApplyResult, RxItem, RxScan } from '../../lib/types'
import { Badge, Button } from '../ui/primitives'
import { Banner, Field, TextInput } from './ui'

interface Row extends RxItem { include: boolean; times_text: string }
const TIMES_OK = /^(?:[01]\d|2[0-3]):[0-5]\d(?:,(?:[01]\d|2[0-3]):[0-5]\d){0,5}$/
const rowError = (r: Row) => (!r.name.trim() ? 'Name is required' : !r.dose.trim() ? 'Dose is required' : !TIMES_OK.test(r.times_text.replace(/\s/g, '')) ? 'Times must look like 08:00,20:00' : null)

const toRows = (scan: RxScan): Row[] => scan.items.map((i) => ({
  ...i, times_text: i.times ?? '',
  // Safe defaults: a row starts ticked only if it is new or changes something, has a dose and times, no allergy conflict, and the reader is fairly sure
  // it read the line correctly. Anything else is left for the admin to fix and tick on purpose.
  include: i.status !== 'duplicate' && !i.allergy_conflict && !!i.times && !!i.dose.trim() && i.confidence >= 0.7,
}))

/** Read a prescription photo/PDF, then let a family admin review every proposed row before anything is added. */
export function PrescriptionScanner({ pid, patientName, reload }: { pid: string; patientName: string; reload: () => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'scanning' | 'review' | 'applying' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [scan, setScan] = useState<RxScan | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [preview, setPreview] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [follow, setFollow] = useState<{ on: boolean; title: string; starts_at: string }>({ on: false, title: 'Follow-up', starts_at: '' })
  const [result, setResult] = useState<RxApplyResult | null>(null)

  const reset = () => { setPhase('idle'); setError(null); setScan(null); setRows([]); setResult(null); setFollow({ on: false, title: 'Follow-up', starts_at: '' }); if (preview) URL.revokeObjectURL(preview); setPreview(null); if (input.current) input.current.value = '' }

  const handle = async (file: File | undefined) => {
    if (!file) return
    setError(null); setPhase('preparing')
    if (file.type.startsWith('image/')) setPreview(URL.createObjectURL(file))
    try {
      const up = await prepareUpload(file)
      setPhase('scanning')
      const s = await api.admin.scanPrescription(pid, { filename: up.filename, media_type: up.media_type, data: up.data })
      setScan(s); setRows(toRows(s))
      setFollow((f) => ({ ...f, title: s.follow_up?.notes ? `Follow-up: ${s.follow_up.notes}`.slice(0, 100) : 'Follow-up' }))
      setPhase('review')
    } catch (e) {
      setError(e instanceof UploadError || e instanceof Error ? e.message : 'Something went wrong')
      setPhase('idle')
    }
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); void handle(e.dataTransfer.files?.[0]) }

  const patch = (key: string, p: Partial<Row>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...p } : r)))
  const selected = rows.filter((r) => r.include)
  const invalid = selected.some((r) => rowError(r)) || (follow.on && !follow.starts_at)

  const apply = async () => {
    setPhase('applying'); setError(null)
    try {
      const items = rows.map((r) => (!r.include ? { action: 'skip', name: r.name } : {
        action: r.existing_id ? 'update' : 'add', existing_id: r.existing_id, name: r.name.trim(), dose: r.dose.trim(), times: r.times_text.replace(/\s/g, ''),
        with_food: r.with_food, instructions: r.instructions, duration: r.duration, purpose: undefined,
      }))
      const res = await api.admin.applyPrescription(pid, {
        prescriber: scan?.document.prescriber || undefined, items,
        appointment: follow.on ? { title: follow.title || 'Follow-up', starts_at: `${follow.starts_at}:00`, doctor: scan?.document.prescriber || '' } : undefined,
      })
      setResult(res); setPhase('done'); await reload()
    } catch (e) { setError((e as Error).message); setPhase('review') }
  }

  const busy = phase === 'preparing' || phase === 'scanning' || phase === 'applying'
  return (
    <section aria-label="Scan a prescription" className="mb-5 rounded-2xl border border-brand/30 bg-gradient-to-br from-brand/5 to-transparent p-4" data-testid="rx-scanner">
      <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold"><ScanLine size={16} className="text-brand" />Add from a prescription</h4>

      {(phase === 'idle' || busy) && (
        <>
          <p className="mb-3 text-xs leading-relaxed text-muted">Take a photo or upload a prescription, discharge summary or medicine list. CareCircle reads it and proposes medicines for <b>{patientName.split(' ')[0]}</b>. <b>Nothing is added until you review and confirm it.</b> The file is not saved.</p>
          <div onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
            className={`flex flex-wrap items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-5 text-center transition ${drag ? 'border-brand bg-brand/10' : 'border-line'}`}>
            {busy ? (
              <div role="status" className="flex items-center gap-3 text-sm"><Loader2 size={18} className="animate-spin text-brand" />{phase === 'preparing' ? 'Preparing the photo…' : 'Reading the prescription…'}</div>
            ) : (
              <>
                <input ref={input} type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" aria-label="Prescription photo or PDF" onChange={(e) => void handle(e.target.files?.[0])} />
                <Button variant="primary" onClick={() => { input.current?.removeAttribute('capture'); input.current?.click() }}><Upload size={15} />Choose a photo or PDF</Button>
                <Button onClick={() => { input.current?.setAttribute('capture', 'environment'); input.current?.click() }}><Camera size={15} />Take a photo</Button>
                <span className="w-full text-xs text-muted">…or drag a file here. JPEG, PNG, WebP or PDF.</span>
              </>
            )}
          </div>
          {error && <div className="mt-3"><Banner kind="error">{error}</Banner></div>}
        </>
      )}

      {(phase === 'review' || phase === 'applying') && scan && (
        <div className="space-y-3" data-testid="rx-review">
          <div className="flex flex-wrap items-start gap-3">
            {preview && <img src={preview} alt="Uploaded prescription" className="h-24 w-20 rounded-lg border border-line object-cover" />}
            <div className="min-w-[200px] flex-1 text-sm">
              <div className="flex items-center gap-2 font-semibold"><FileText size={15} />{scan.items.length} medicine{scan.items.length === 1 ? '' : 's'} found</div>
              <div className="text-xs text-muted">{[scan.document.prescriber && `Prescriber: ${scan.document.prescriber}`, scan.document.date && `Dated ${scan.document.date}`, scan.document.patient_name && `For: ${scan.document.patient_name}`].filter(Boolean).join(' · ') || 'No prescriber or date was read.'}</div>
            </div>
            <Button size="sm" onClick={reset} disabled={phase === 'applying'}><X size={13} />Discard</Button>
          </div>

          {scan.warnings.map((w) => <p key={w} role="alert" className="flex items-start gap-2 rounded-xl bg-watch-soft px-3 py-2 text-sm text-watch"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{w}</p>)}
          <p className="text-[11px] leading-snug text-muted">Automatic reading can misread handwriting. Compare every row with the original. This is not medical advice.</p>

          <ul className="space-y-2.5">
            {rows.map((r) => {
              const err = r.include ? rowError(r) : null
              return (
                <li key={r.key} data-testid={`rx-row-${r.key}`} className={`rounded-2xl border p-3 ${r.allergy_conflict ? 'border-urgent bg-urgent-soft/40' : 'border-line bg-surface'} ${r.include ? '' : 'opacity-70'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={r.include} onChange={(e) => patch(r.key, { include: e.target.checked })} aria-label={`Include ${r.name}`} />{r.name}</label>
                    {r.status === 'new' && <Badge kind="ok">New</Badge>}
                    {r.status === 'update' && <Badge kind="watch">Changes {r.current?.dose} → {r.dose}</Badge>}
                    {r.status === 'duplicate' && <Badge kind="skipped">Already on the list</Badge>}
                    {r.allergy_conflict && <Badge kind="urgent"><ShieldAlert size={11} />Allergy</Badge>}
                    <span className="ml-auto text-[11px] text-muted" title="How sure the reader is that it read this line correctly">{Math.round(r.confidence * 100)}% sure</span>
                  </div>
                  {r.source_text && <p className="mt-1 text-xs italic text-muted">As written: “{r.source_text}”</p>}
                  <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_1.3fr]">
                    <Field label="Name"><TextInput value={r.name} onChange={(e) => patch(r.key, { name: e.target.value })} aria-label={`Name for ${r.key}`} /></Field>
                    <Field label="Dose"><TextInput value={r.dose} onChange={(e) => patch(r.key, { dose: e.target.value })} aria-label={`Dose for ${r.name}`} /></Field>
                    <Field label="Times (HH:MM, comma separated)"><TextInput value={r.times_text} onChange={(e) => patch(r.key, { times_text: e.target.value, include: r.include || false })} aria-label={`Times for ${r.name}`} placeholder="08:00,20:00" /></Field>
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={r.with_food} onChange={(e) => patch(r.key, { with_food: e.target.checked })} />Take with food{r.duration && <span className="text-muted"> · {r.duration}</span>}{r.instructions && <span className="text-muted"> · {r.instructions}</span>}</label>
                  {r.warnings.map((w) => <p key={w} className="mt-1.5 flex items-start gap-1.5 text-xs text-watch"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{w}</p>)}
                  {err && <p role="alert" className="mt-1.5 text-xs text-urgent">{err}</p>}
                </li>
              )
            })}
          </ul>

          {scan.follow_up && (
            <div className="rounded-2xl border border-line bg-surface p-3 text-sm">
              <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={follow.on} onChange={(e) => setFollow({ ...follow, on: e.target.checked })} />Also book the follow-up</label>
              <p className="text-xs text-muted">Written on the document: “{scan.follow_up.when || scan.follow_up.notes}”. Choose the date.</p>
              {follow.on && <div className="mt-2 grid gap-2 sm:grid-cols-2"><Field label="Title"><TextInput value={follow.title} onChange={(e) => setFollow({ ...follow, title: e.target.value })} /></Field><Field label="When"><TextInput type="datetime-local" value={follow.starts_at} onChange={(e) => setFollow({ ...follow, starts_at: e.target.value })} /></Field></div>}
            </div>
          )}

          {error && <Banner kind="error">{error}</Banner>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted">{selected.length} of {rows.length} selected</span>
            <Button variant="primary" onClick={apply} disabled={phase === 'applying' || (selected.length === 0 && !follow.on) || invalid}>{phase === 'applying' ? 'Adding…' : `Add ${selected.length} selected`}</Button>
          </div>
        </div>
      )}

      {phase === 'done' && result && (
        <div className="space-y-2" data-testid="rx-done">
          <Banner kind="ok">
            <span><b>Done.</b> {result.added.length > 0 && `Added ${result.added.join(', ')}. `}{result.updated.length > 0 && `Updated ${result.updated.join(', ')}. `}{result.skipped > 0 && `${result.skipped} skipped. `}{result.appointment && `Follow-up booked for ${result.appointment}.`}</span>
          </Banner>
          {result.errors.map((e, i) => <Banner key={i} kind="error">{e.name ? `${e.name}: ` : ''}{e.message}</Banner>)}
          <div className="flex items-center gap-2 text-xs text-muted"><CheckCircle2 size={13} />The medicines are in today's schedule and Alexa knows about them from the next message.</div>
          <Button size="sm" onClick={reset}>Scan another</Button>
        </div>
      )}
    </section>
  )
}
