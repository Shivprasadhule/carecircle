import { motion } from 'framer-motion'
import { levelColor } from '../../lib/format'
import { useCare } from '../../state/care'
import { Avatar } from '../ui/primitives'

/** One chip per patient this account may see, with a one-glance risk dot and open-alert count. Hidden when there is only one. */
export function PatientSwitcher() {
  const { patients, patientId, setPatientId } = useCare()
  if (patients.length < 2) return null
  return (
    <div role="tablist" aria-label="Choose a patient" className="no-scrollbar -mx-1 mb-4 flex gap-2 overflow-x-auto px-1 py-1" data-testid="patient-switcher">
      {patients.map((p) => {
        const on = p.id === patientId
        return (
          <button key={p.id} role="tab" aria-selected={on} onClick={() => setPatientId(p.id)}
            className={`relative flex shrink-0 items-center gap-2.5 rounded-2xl border px-3 py-2 text-left transition ${on ? 'border-brand bg-surface shadow-[var(--shadow)]' : 'border-line bg-surface2 hover:bg-surface'}`}>
            {on && <motion.span layoutId="patient-ring" className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-brand/50" />}
            <span className="relative"><Avatar name={p.name} size={34} />
              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface" style={{ background: levelColor(p.level) }} title={`Risk: ${p.level}`} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-tight">{p.name.split(' ')[0]}<span className="ml-1 text-xs font-normal text-muted">{p.age}</span></span>
              <span className="block max-w-[170px] truncate text-[11px] text-muted">{p.conditions}</span>
            </span>
            {p.open_alerts > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-high px-1 text-[11px] font-bold text-white" aria-label={`${p.open_alerts} open alerts`}>{p.open_alerts}</span>}
          </button>
        )
      })}
    </div>
  )
}
