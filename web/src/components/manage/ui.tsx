import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { useCallback, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Button } from '../ui/primitives'

const input = 'mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-60'

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="block text-xs font-semibold text-muted">{label}{children}{hint && <span className="mt-0.5 block font-normal">{hint}</span>}</label>
}
export const TextInput = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`${input} ${p.className ?? ''}`} />
export const TextArea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={`${input} min-h-24 resize-y ${p.className ?? ''}`} />
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`${input} ${p.className ?? ''}`} />

/** A destructive button that needs two taps (no browser dialogs): the first arms it, the second does it. */
export function TwoTap({ label, confirmLabel = 'Tap again to confirm', onConfirm, disabled, size = 'sm' }: { label: string; confirmLabel?: string; onConfirm: () => void; disabled?: boolean; size?: 'sm' | 'md' }) {
  const [armed, setArmed] = useState(false)
  return (
    <Button size={size} disabled={disabled} onClick={() => { if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 4000) } else { setArmed(false); onConfirm() } }}
      className={armed ? '!border-urgent !bg-urgent !text-white' : '!text-urgent'}>{armed ? confirmLabel : label}</Button>
  )
}

export function Banner({ kind, children }: { kind: 'error' | 'ok'; children: ReactNode }) {
  return kind === 'error'
    ? <p role="alert" className="flex items-start gap-2 rounded-xl bg-urgent-soft px-3 py-2 text-sm text-urgent"><AlertCircle size={16} className="mt-0.5 shrink-0" />{children}</p>
    : <p role="status" className="flex items-start gap-2 rounded-xl bg-ok-soft px-3 py-2 text-sm text-ok"><CheckCircle2 size={16} className="mt-0.5 shrink-0" />{children}</p>
}

/** Run an async admin action; expose the server's own error text (e.g. "A family must keep at least one admin") and a success note. */
export function useAction(after?: () => Promise<void> | void) {
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = useCallback(async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(null); setOk(null)
    try { await fn(); setOk(success); await after?.() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }, [after])
  return { run, error, ok, busy, clear: () => { setError(null); setOk(null) } }
}

export const Messages = ({ a }: { a: { error: string | null; ok: string | null } }) => <>{a.error && <Banner kind="error">{a.error}</Banner>}{a.ok && <Banner kind="ok">{a.ok}</Banner>}</>
