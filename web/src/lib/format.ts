import type { Level, Severity } from './types'

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
export const fmtSlot = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(); d.setHours(h, m, 0, 0)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
export function ago(iso: string, now = Date.now()) {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 1440) return `${Math.round(m / 60)} h ago`
  return `${Math.round(m / 1440)} d ago`
}
export const moodFace = (m: number) => ['', '😞', '😕', '😐', '🙂', '😄'][m] ?? '🙂'
export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
export const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
export const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export const LEVEL_LABEL: Record<Level, string> = { ok: 'All good', info: 'Info', watch: 'Keep an eye', high: 'Needs attention', urgent: 'Urgent' }
export const levelColor = (l: Level | Severity) =>
  ({ ok: 'var(--ok)', info: 'var(--info)', watch: 'var(--watch)', high: 'var(--high)', urgent: 'var(--urgent)' })[l]
